import { includes, some } from 'lodash';
import { Subject } from 'rxjs/index';
import { filter } from 'rxjs/internal/operators';
import { take } from 'rxjs/operators';

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

import {
    CardinalEventResponse,
    CardinalEventType,
    CardinalInitializationType,
    CardinalPartialOrder,
    CardinalPaymentBrand,
    CardinalPaymentStep,
    CardinalScriptLoader,
    CardinalSetupCompletedData,
    CardinalSDK,
    CardinalTriggerEvents,
    CardinalValidatedAction,
    CardinalValidatedData,
    SignatureValidationErrors,
} from './index';
/*import {PartialOrder} from "../cybersource";
import Address from "../../../address/address";
import {CardinalAddress} from "./cardinal";*/

export default class PaypalProThreeDSecurePaymentProcessor {
    private _Cardinal?: CardinalSDK;
    private _paymentMethod?: PaymentMethod;
    private _cardinalEvent$: Subject<CardinalEventResponse>;

    constructor(
        private _store: CheckoutStore,
        private _orderActionCreator: OrderActionCreator,
        private _paymentActionCreator: PaymentActionCreator,
        private _cyberSourceScriptLoader: CardinalScriptLoader
    ) {
        this._cardinalEvent$ = new Subject();
    }

    initialize(paymentMethod: PaymentMethod): Promise<InternalCheckoutSelectors> {
        this._paymentMethod = paymentMethod;

        if (!this._paymentMethod || !this._paymentMethod.clientToken) {
            throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
        }

        const clientToken = this._paymentMethod.clientToken;

        return this._cyberSourceScriptLoader.load(this._paymentMethod.config.testMode)
            .then(Cardinal => {
                this._Cardinal = Cardinal;

                this._Cardinal.configure({
                    logging: {
                        level: 'on',
                    },
                });

                this._Cardinal.on(CardinalEventType.SetupCompleted, (setupCompletedData: CardinalSetupCompletedData) => {
                    this._resolveSetupEvent();
                });

                this._Cardinal.on(CardinalEventType.Validated, (data: CardinalValidatedData, jwt: string) => {
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
                            if (includes(SignatureValidationErrors, data.ErrorNumber)) {
                                this._rejectSetupEvent();
                            } else {
                                this._rejectAuthorizationPromise(data);
                            }
                    }
                });

                return ((cardinal: CardinalSDK): Promise<InternalCheckoutSelectors> => {
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
                })(this._Cardinal);
            }).then(() => {
                return this._store.getState();
            });
    }

    execute(payment: OrderPaymentRequestBody, order: OrderRequestBody, paymentData: CreditCardInstrument, options?: PaymentRequestOptions): Promise<InternalCheckoutSelectors> {
        if (!this._Cardinal) {
            return Promise.reject(new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized));
        }

        return ((cardinal: CardinalSDK): Promise<InternalCheckoutSelectors> => {
            return cardinal.trigger(CardinalTriggerEvents.BIN_PROCESS, paymentData.ccNumber).then(result => {
                if (result && result.Status) {
                    return this._store.dispatch(this._orderActionCreator.submitOrder(order, options))
                        .then(() => {
                            // const partialOrder: CardinalPartialOrder = this._mapToPartialOrder();

                            return this._store.dispatch(
                                this._paymentActionCreator.submitPayment({...payment, paymentData})
                            );
                        }).catch(error => {
                            if (!(error instanceof RequestError) || !some(error.body.errors, { code: 'enrolled_card' })) {
                                return Promise.reject(error);
                            }

                            const continueObject = {
                                AcsUrl: error.body.three_ds_result.acs_url,
                                Payload: error.body.three_ds_result.merchant_data,
                            };

                            const partialOrder = {
                                OrderDetails: {
                                    TransactionId: error.body.three_ds_result.payer_auth_request,
                                },
                            };

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

                                cardinal.continue(CardinalPaymentBrand.CCA, continueObject, partialOrder);
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
        })(this._Cardinal);
    }

    finalize(options?: PaymentRequestOptions): Promise<InternalCheckoutSelectors> {
        throw new OrderFinalizationNotRequiredError();
    }

    deinitialize(options?: PaymentRequestOptions): Promise<InternalCheckoutSelectors> {
        return Promise.resolve(this._store.getState());
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

    /*private _mapToPartialOrder(): PartialOrder {
        const billingAddress = this._store.getState().billingAddress.getBillingAddress();
        const shippingAddress = this._store.getState().shippingAddress.getShippingAddress();

        return {
            Consumer: {

            },
            OrderDetails: {

            },
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
    }*/
}
