import { CheckoutStore, InternalCheckoutSelectors } from '../../../checkout';
import {
    MissingDataError, MissingDataErrorType, NotInitializedError,
    NotInitializedErrorType
} from '../../../common/error/errors';
import {OrderActionCreator, OrderRequestBody} from '../../../order';
import {CreditCardInstrument} from '../../payment';
import PaymentMethod from '../../payment-method';
import PaymentMethodActionCreator from '../../payment-method-action-creator';
import { PaymentInitializeOptions, PaymentRequestOptions } from '../../payment-request-options';
import * as paymentStatusTypes from '../../payment-status-types';
import PaymentStrategy from '../payment-strategy';

import { PaypalProPaymentProcessor, PaypalProThreeDSecurePaymentProcessor } from './index';

export default class PaypalProPaymentStrategy implements PaymentStrategy {
    private _processor?: PaypalProPaymentProcessor | PaypalProThreeDSecurePaymentProcessor;
    private _paymentMethod?: PaymentMethod;

    constructor(
        private _store: CheckoutStore,
        private _paymentMethodActionCreator: PaymentMethodActionCreator,
        private _orderActionCreator: OrderActionCreator,
        private _threeDSecurePaymentProcessor: PaypalProThreeDSecurePaymentProcessor,
        private _paymentProcessor: PaypalProPaymentProcessor
    ) {}

    initialize(options: PaymentInitializeOptions): Promise<InternalCheckoutSelectors> {
        const { methodId } = options;

        return this._store.dispatch(this._paymentMethodActionCreator.loadPaymentMethod(methodId)).then( state => {
            this._paymentMethod = state.paymentMethods.getPaymentMethod(methodId);

            if (!this._paymentMethod || !this._paymentMethod.config) {
                throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
            }

            this._processor = this._paymentMethod.config.is3dsEnabled ? this._threeDSecurePaymentProcessor : this._paymentProcessor;

            return this._processor.initialize(this._paymentMethod);
        });
    }

    execute(payload: OrderRequestBody, options?: PaymentRequestOptions): Promise<InternalCheckoutSelectors> {
        const { payment, ...order } = payload;
        const paymentData = payment && payment.paymentData as CreditCardInstrument;

        if (this._isPaymentAcknowledged()) {
            return this._store.dispatch(
                this._orderActionCreator.submitOrder({
                    ...payload,
                    payment: payload.payment ? { methodId: payload.payment.methodId } : undefined,
                }, options)
            );
        }

        if (!this._processor) {
            throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
        }

        if (!payment || !paymentData) {
            throw new MissingDataError(MissingDataErrorType.MissingCheckout);
        }

        return this._processor.execute(payment, order, paymentData, options);
    }

    finalize(options?: PaymentRequestOptions): Promise<InternalCheckoutSelectors> {
        if (!this._processor) {
            throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
        }

        return this._processor.finalize(options);
    }

    deinitialize(options?: PaymentRequestOptions): Promise<InternalCheckoutSelectors> {
        if (!this._processor) {
            throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
        }

        return this._processor.deinitialize(options);
    }

    private _isPaymentAcknowledged(): boolean {
        const state = this._store.getState();

        return state.payment.getPaymentStatus() === paymentStatusTypes.ACKNOWLEDGE;
    }
}
