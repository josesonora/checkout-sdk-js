import { some } from 'lodash';

import { CheckoutStore, InternalCheckoutSelectors } from '../../../checkout/index';
import {
    MissingDataError,
    MissingDataErrorType,
    RequestError
} from '../../../common/error/errors/index';
import { default as Payment, CreditCardInstrument } from '../../payment';
import PaymentActionCreator from '../../payment-action-creator';
import PaymentMethodActionCreator from '../../payment-method-action-creator';

import { CardinalClient, CardinalOrderData } from './index';

export default class CardinalThreeDSecureFlow {
    private _clientToken?: string;

    constructor(
        private _store: CheckoutStore,
        private _paymentActionCreator: PaymentActionCreator,
        private _paymentMethodActionCreator: PaymentMethodActionCreator,
        private _cardinalClient: CardinalClient
    ) {}

    prepare(methodId: string): Promise<void> {
        if (this._clientToken) {
            return Promise.resolve();
        }

        return this._store.dispatch(this._paymentMethodActionCreator.loadPaymentMethod(methodId))
            .then(state => {
                const method = state.paymentMethods.getPaymentMethod(methodId);

                if (!method || !method.config) {
                    throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
                }

                return this._cardinalClient.initialize(method.config.testMode)
                    .then(() => {
                        if (!method.clientToken) {
                            throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
                        }

                        this._clientToken = method.clientToken;

                        return this._cardinalClient.configure(this._clientToken);
                    });
            });
    }

    start(payment: Payment): Promise<InternalCheckoutSelectors> {
        if (!payment) {
            throw new MissingDataError(MissingDataErrorType.MissingPayment);
        }

        const paymentData = payment.paymentData as CreditCardInstrument;

        return this._cardinalClient.runBinProcess(paymentData.ccNumber)
            .then(() => {
                if (!this._clientToken) {
                    throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
                }

                payment = {
                    ...payment,
                    paymentData: {
                        ...paymentData,
                        threeDSecure: { token: this._clientToken },
                    },
                };

                return this._store.dispatch(this._paymentActionCreator.submitPayment(payment));
            })
            .catch(error => {
                if (!(error instanceof RequestError) || !some(error.body.errors, {code: 'enrolled_card'})) {
                    return Promise.reject(error);
                }

                return this._cardinalClient.getThreeDSecureData(
                    error.body.three_ds_result,
                    this._getOrderData(paymentData)
                )
                .then(threeDSecure =>
                    this._store.dispatch(this._paymentActionCreator.submitPayment({
                        ...payment,
                        paymentData: {
                            ...paymentData,
                            threeDSecure,
                        },
                    }))
                );
            });
    }

    private _getOrderData(paymentData: CreditCardInstrument): CardinalOrderData {
        const billingAddress = this._store.getState().billingAddress.getBillingAddress();
        const shippingAddress = this._store.getState().shippingAddress.getShippingAddress();
        const checkout = this._store.getState().checkout.getCheckout();
        const order = this._store.getState().order.getOrder();

        if (!billingAddress || !billingAddress.email) {
            throw new MissingDataError(MissingDataErrorType.MissingBillingAddress);
        }

        if (!checkout) {
            throw new MissingDataError(MissingDataErrorType.MissingCheckout);
        }

        if (!order) {
            throw new MissingDataError(MissingDataErrorType.MissingOrder);
        }

        return {
            billingAddress,
            shippingAddress,
            currencyCode: checkout.cart.currency.code,
            id: order.orderId.toString(),
            amount: checkout.cart.cartAmount,
            paymentData,
        };
    }
}
