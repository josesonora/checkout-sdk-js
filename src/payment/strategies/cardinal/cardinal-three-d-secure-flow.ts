import { merge, some } from 'lodash';

import { CheckoutStore, InternalCheckoutSelectors } from '../../../checkout';
import { RequestError } from '../../../common/error/errors';
import { HostedForm } from '../../../hosted-form';
import { OrderRequestBody } from '../../../order';
import isVaultedInstrument from '../../is-vaulted-instrument';
import PaymentActionCreator from '../../payment-action-creator';
import PaymentMethod from '../../payment-method';
import PaymentMethodActionCreator from '../../payment-method-action-creator';
import { PaymentRequestOptions } from '../../payment-request-options';
import PaymentStrategy from '../payment-strategy';

import CardinalClient, { CardinalOrderData } from './cardinal-client';

export default class CardinalThreeDSecureFlow {
    constructor(
        private _store: CheckoutStore,
        private _paymentActionCreator: PaymentActionCreator,
        private _paymentMethodActionCreator: PaymentMethodActionCreator,
        private _cardinalClient: CardinalClient
    ) {}

    async prepare(method: PaymentMethod): Promise<void> {
        await this._cardinalClient.load(method.id, method.config.testMode);
    }

    async start(
        execute: PaymentStrategy['execute'],
        payload: OrderRequestBody,
        options?: PaymentRequestOptions,
        hostedForm?: HostedForm
    ): Promise<InternalCheckoutSelectors> {
        const { instruments: { getCardInstrument } } = this._store.getState();
        const { payment: { paymentData = {} } = {} } = payload;
        const instrument = isVaultedInstrument(paymentData) && getCardInstrument(paymentData.instrumentId);
        const bin = instrument ? instrument.iin : hostedForm && hostedForm.getBin();

        try {
            return await execute(payload, options);
        } catch (error) {
            if (!(error instanceof RequestError) || !this._isAdditionalActionRequired(error)) {
                throw error;
            }
            await this._cardinalClient.configure(error.body.additional_action_required.data.token);

            if (bin) {
                await this._cardinalClient.runBinProcess(bin);
            }

            const threeDSecure = {
                xid: error.body.three_ds_result.payer_auth_request,
            };

            try {
                if (!hostedForm) {
                    return await this._store.dispatch(this._paymentActionCreator.submitPayment(merge(payload.payment, {
                        paymentData: { threeDSecure },
                    })));
                }

                await hostedForm.submit(merge(payload.payment, {
                    paymentData: { threeDSecure },
                }));

                return this._store.getState();
            } catch (error) {
                if (!(error instanceof RequestError) || !some(error.body.errors, {code: 'three_d_secure_required'})) {
                    throw error;
                }

                await this._cardinalClient.getThreeDSecureData(error.body.three_ds_result, this._getOrderData());
                const threeDSecure = { token: error.body.three_ds_result.payer_auth_request };

                if (!hostedForm) {
                    return await this._store.dispatch(this._paymentActionCreator.submitPayment(merge(payload.payment, {
                        paymentData: { threeDSecure },
                    })));
                }

                await hostedForm.submit(merge(payload.payment, {
                    paymentData: { threeDSecure },
                }));

                return this._store.getState();
            }
        }
    }

    private _isAdditionalActionRequired(error: RequestError): boolean {
        const { additional_action_required, status } = error.body;

        return status === 'additional_action_required'
            && additional_action_required
            && additional_action_required.type === 'cardinal_setup';
    }

    // @ts-ignore
    private async _getClientToken(method: PaymentMethod): Promise<string> {
        if (method.clientToken) {
            return method.clientToken;
        }

        const { paymentMethods: { getPaymentMethodOrThrow } } = await this._store.dispatch(
            this._paymentMethodActionCreator.loadPaymentMethod(method.id)
        );

        return getPaymentMethodOrThrow(method.id).clientToken || '';
    }

    private _getOrderData(): CardinalOrderData {
        const state = this._store.getState();
        const billingAddress = state.billingAddress.getBillingAddressOrThrow();
        const shippingAddress = state.shippingAddress.getShippingAddress();
        const checkout = state.checkout.getCheckoutOrThrow();
        const order = state.order.getOrderOrThrow();

        return {
            billingAddress,
            shippingAddress,
            currencyCode: checkout.cart.currency.code,
            id: order.orderId.toString(),
            amount: checkout.cart.cartAmount,
        };
    }
}
