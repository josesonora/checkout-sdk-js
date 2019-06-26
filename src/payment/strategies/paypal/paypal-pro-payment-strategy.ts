import { InternalCheckoutSelectors } from '../../../checkout';
import { OrderRequestBody } from '../../../order';
import { PaymentRequestOptions } from '../../payment-request-options';
import * as paymentStatusTypes from '../../payment-status-types';

import { CreditCardCardinalPaymentStrategy } from '../credit-card';

export default class PaypalProPaymentStrategy extends CreditCardCardinalPaymentStrategy {
    execute(payload: OrderRequestBody, options?: PaymentRequestOptions): Promise<InternalCheckoutSelectors> {
        if (this._isPaymentAcknowledged()) {
            return this._store.dispatch(
                this._orderActionCreator.submitOrder({
                    ...payload,
                    payment: payload.payment ? { methodId: payload.payment.methodId } : undefined,
                }, options)
            );
        }

        return super.execute(payload, options);
    }

    private _isPaymentAcknowledged(): boolean {
        const state = this._store.getState();

        return state.payment.getPaymentStatus() === paymentStatusTypes.ACKNOWLEDGE;
    }
}
