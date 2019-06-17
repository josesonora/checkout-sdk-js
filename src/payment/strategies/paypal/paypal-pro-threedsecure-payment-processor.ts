import { includes, some } from 'lodash';
import { Subject } from 'rxjs/index';
import { filter } from 'rxjs/internal/operators';
import { take } from 'rxjs/operators';

import Address from '../../../address/address';
import { CheckoutStore, InternalCheckoutSelectors } from '../../../checkout';
import {
    MissingDataError,
    MissingDataErrorType,
    NotInitializedError,
    NotInitializedErrorType,
    RequestError,
    StandardError
} from '../../../common/error/errors';
import { OrderActionCreator, OrderPaymentRequestBody, OrderRequestBody } from '../../../order';
import { OrderFinalizationNotRequiredError } from '../../../order/errors';
import { CreditCardInstrument, ThreeDSecure } from '../../payment';
import PaymentActionCreator from '../../payment-action-creator';
import PaymentMethod from '../../payment-method';
import { PaymentRequestOptions } from '../../payment-request-options';

import CardinalScriptLoader from './cardinal-script-loader';
import {
    CardinalAccount,
    CardinalAddress,
    CardinalConsumer,
    CardinalEventResponse,
    CardinalEventType,
    CardinalInitializationType,
    CardinalPartialOrder,
    CardinalPaymentBrand,
    CardinalPaymentStep,
    CardinalSetupCompletedData,
    CardinalSignatureValidationErrors,
    CardinalSDK,
    CardinalTriggerEvents,
    CardinalValidatedAction,
    CardinalValidatedData
} from './index';

export default class PaypalProThreeDSecurePaymentProcessor {
    private _Cardinal?: CardinalSDK;
    private _paymentMethod?: PaymentMethod;
    private _cardinalEvent$: Subject<CardinalEventResponse>;

    constructor(
        private _store: CheckoutStore,
        private _orderActionCreator: OrderActionCreator,
        private _paymentActionCreator: PaymentActionCreator,
        private _cardinalScriptLoader: CardinalScriptLoader
    ) {
        this._cardinalEvent$ = new Subject();
    }

    initialize(paymentMethod: PaymentMethod): Promise<InternalCheckoutSelectors> {
        this._paymentMethod = paymentMethod;

        return this._cardinalScriptLoader.load(this._paymentMethod.config.testMode)
            .then(Cardinal => {
                this._Cardinal = Cardinal;

                return this._store.getState();
            });
    }

    execute(payment: OrderPaymentRequestBody, order: OrderRequestBody, paymentData: CreditCardInstrument, options?: PaymentRequestOptions): Promise<InternalCheckoutSelectors> {
        if (!this._Cardinal) {
            return Promise.reject(new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized));
        }

        if (!this._paymentMethod || !this._paymentMethod.clientToken) {
            throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
        }

        return ((cardinal: CardinalSDK): Promise<InternalCheckoutSelectors> => {
            return this._configureCardinalSDK(this._paymentMethod.clientToken, cardinal).then(() => {
                return cardinal.trigger(CardinalTriggerEvents.BIN_PROCESS, paymentData.ccNumber).then(result => {
                    if (result && result.Status) {
                        return this._store.dispatch(this._orderActionCreator.submitOrder(order, options))
                            .then(() => {
                                const partialOrder = this._mapToPartialOrder(paymentData);

                                return new Promise<string>((resolve, reject) => {
                                    this._cardinalEvent$
                                        .pipe(take(1), filter(event => event.step === CardinalPaymentStep.AUTHORIZATION))
                                        .subscribe((event: CardinalEventResponse) => {
                                            if (!event.status) {
                                                const message = event.data ? event.data.ErrorDescription : '';
                                                reject(new StandardError(message));
                                            }
                                            resolve(event.jwt);
                                        });

                                    cardinal.start(CardinalPaymentBrand.CCA, partialOrder);
                                }).then(jwt =>
                                    this._store.dispatch(
                                        this._paymentActionCreator.submitPayment({
                                            ...payment,
                                            paymentData: this._addThreeDSecureData(paymentData, { token: jwt }),
                                        })
                                    )
                                );
                            });
                    } else {
                        throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
                    }
                });
            }).catch(error => {
                cardinal.off(CardinalEventType.SetupCompleted);
                cardinal.off(CardinalEventType.Validated);

                throw error;
            });
        })(this._Cardinal);
    }

    finalize(options?: PaymentRequestOptions): Promise<InternalCheckoutSelectors> {
        throw new OrderFinalizationNotRequiredError();
    }

    deinitialize(options?: PaymentRequestOptions): Promise<InternalCheckoutSelectors> {
        return Promise.resolve(this._store.getState());
    }

    private _configureCardinalSDK(clientToken: string, cardinal: CardinalSDK): Promise<void> {
        cardinal.on(CardinalEventType.SetupCompleted, (setupCompletedData: CardinalSetupCompletedData) => {
            this._resolveSetupEvent();
        });

        cardinal.on(CardinalEventType.Validated, (data: CardinalValidatedData, jwt: string) => {
            switch (data.ActionCode) {
                case CardinalValidatedAction.SUCCESS:
                    this._resolveAuthorizationPromise(jwt);
                    break;
                case CardinalValidatedAction.NOACTION:
                    if (data.ErrorNumber > 0) {
                        this._rejectAuthorizationPromise(data);
                    } else {
                        this._resolveAuthorizationPromise(jwt);
                    }
                    break;
                case CardinalValidatedAction.FAILURE:
                    data.ErrorDescription = 'User failed authentication or an error was encountered while processing the transaction';
                    this._rejectAuthorizationPromise(data);
                    break;
                case CardinalValidatedAction.ERROR:
                    if (includes(CardinalSignatureValidationErrors, data.ErrorNumber)) {
                        this._rejectSetupEvent();
                    } else {
                        this._rejectAuthorizationPromise(data);
                    }
            }
        });

        return new Promise((resolve, reject) => {
            this._cardinalEvent$
                .pipe(take(1), filter(event => event.step === CardinalPaymentStep.SETUP))
                .subscribe((event: CardinalEventResponse) => {
                    event.status ? resolve() : reject(new MissingDataError(MissingDataErrorType.MissingPaymentMethod));
                });

            cardinal.setup(CardinalInitializationType.Init, {
                jwt: clientToken,
            });
        });
    }

    private _resolveAuthorizationPromise(jwt: string): void {
        this._cardinalEvent$.next({
            step: CardinalPaymentStep.AUTHORIZATION,
            jwt,
            status: true,
        });
    }

    private _resolveSetupEvent(): void {
        this._cardinalEvent$.next({
            step: CardinalPaymentStep.SETUP,
            status: true,
        });
    }

    private _rejectSetupEvent(): void {
        this._cardinalEvent$.next({
            step: CardinalPaymentStep.SETUP,
            status: false,
        });
    }

    private _rejectAuthorizationPromise(data: CardinalValidatedData): void {
        this._cardinalEvent$.next({
            step: CardinalPaymentStep.AUTHORIZATION,
            data,
            status: false,
        });
    }

    private _addThreeDSecureData(payment: CreditCardInstrument, threeDSecure: ThreeDSecure): CreditCardInstrument {
        payment.threeDSecure = threeDSecure;

        return payment;
    }

    private _mapToPartialOrder(paymentData: CreditCardInstrument): CardinalPartialOrder {
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

        const consumer: CardinalConsumer = {
            Email1: billingAddress.email,
            BillingAddress: this._mapToCardinalAddress(billingAddress),
            Account: this._mapToCardinalAccount(paymentData),
        };

        if (shippingAddress) {
            consumer.ShippingAddress = this._mapToCardinalAddress(shippingAddress);
        }

        return  {
            Consumer: consumer,
            OrderDetails: {
                Amount: checkout.cart.cartAmount,
                CurrencyCode: checkout.cart.currency.code,
                OrderChannel: 'S',
            },
        };
    }

    private _mapToCardinalAccount(paymentData: CreditCardInstrument): CardinalAccount {
        return {
            AccountNumber: Number(paymentData.ccNumber),
            ExpirationMonth: Number(paymentData.ccExpiry.month),
            ExpirationYear: Number(paymentData.ccExpiry.year),
            NameOnAccount: paymentData.ccName,
            CardCode: Number(paymentData.ccCvv),
        };
    }

    private _mapToCardinalAddress(address: Address): CardinalAddress {
        const cardinalAddress: CardinalAddress = {
            FirstName: address.firstName,
            LastName: address.lastName,
            Address1: address.address1,
            City: address.city,
            State: address.stateOrProvince,
            PostalCode: address.postalCode,
            CountryCode: address.countryCode,
        };

        if (address.address2) {
            cardinalAddress.Address2 = address.address2;
        }

        if (address.phone) {
            cardinalAddress.Phone1 = address.phone;
        }

        return cardinalAddress;
    }
}
