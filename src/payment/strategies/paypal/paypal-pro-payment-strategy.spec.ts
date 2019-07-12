import { createClient as createPaymentClient } from '@bigcommerce/bigpay-client';
import { createAction, Action } from '@bigcommerce/data-store';
import createErrorAction from '@bigcommerce/data-store/lib/create-error-action';
import { createRequestSender } from '@bigcommerce/request-sender';
import { createScriptLoader } from '@bigcommerce/script-loader';
import { merge } from 'lodash';
import { of, Observable } from 'rxjs';

import { createCheckoutStore, CheckoutRequestSender, CheckoutStore, CheckoutValidator } from '../../../checkout';
import CheckoutStoreState from '../../../checkout/checkout-store-state';
import { getCheckoutStoreState, getCheckoutStoreStateWithOrder, getCheckoutWithPayments } from '../../../checkout/checkouts.mock';
import RequestError from '../../../common/error/errors/request-error';
import { getResponse } from '../../../common/http-request/responses.mock';
import { OrderActionCreator, OrderActionType, OrderRequestBody, OrderRequestSender } from '../../../order';
import { getOrderRequestBody } from '../../../order/internal-orders.mock';
import { createSpamProtection, SpamProtectionActionCreator } from '../../../order/spam-protection';
import { RemoteCheckoutActionCreator, RemoteCheckoutActionType, RemoteCheckoutRequestSender } from '../../../remote-checkout';
import { PaymentRequestSender } from '../../index';
import PaymentActionCreator from '../../payment-action-creator';
import { PaymentActionType, SubmitPaymentAction } from '../../payment-actions';
import PaymentMethod from '../../payment-method';
import PaymentMethodActionCreator from '../../payment-method-action-creator';
import { PaymentMethodActionType } from '../../payment-method-actions';
import PaymentMethodRequestSender from '../../payment-method-request-sender';
import { getPaypal } from '../../payment-methods.mock';
import { getErrorPaymentResponseBody } from '../../payments.mock';
import CreditCardCardinalPaymentStrategy from '../credit-card/credit-card-cardinal-payment-strategy';
import { CardinalClient, CardinalScriptLoader } from '../credit-card/index';

import PaypalProPaymentStrategy from './paypal-pro-payment-strategy';

describe('PaypalProPaymentStrategy', () => {
    let initializePaymentAction: Observable<Action>;
    let loadPaymentMethodAction: Observable<Action>;
    let cardinalClient: CardinalClient;
    let payload: OrderRequestBody;
    let orderActionCreator: OrderActionCreator;
    let paymentMethodActionCreator: PaymentMethodActionCreator;
    let paymentActionCreator: PaymentActionCreator;
    let remoteCheckoutActionCreator: RemoteCheckoutActionCreator;
    let scriptLoader: CardinalScriptLoader;
    let submitOrderAction: Observable<Action>;
    let submitPaymentAction: Observable<SubmitPaymentAction>;
    let state: CheckoutStoreState;
    let store: CheckoutStore;
    let strategy: PaypalProPaymentStrategy;
    let paymentMethodMock: PaymentMethod;

    beforeEach(() => {
        paymentMethodMock = { ...getPaypal(), clientToken: 'foo' };

        paymentMethodActionCreator = new PaymentMethodActionCreator(new PaymentMethodRequestSender(createRequestSender()));
        scriptLoader = new CardinalScriptLoader(createScriptLoader());
        cardinalClient = new CardinalClient(scriptLoader);

        remoteCheckoutActionCreator = new RemoteCheckoutActionCreator(
            new RemoteCheckoutRequestSender(createRequestSender())
        );

        orderActionCreator = new OrderActionCreator(
            new OrderRequestSender(createRequestSender()),
            new CheckoutValidator(new CheckoutRequestSender(createRequestSender())),
            new SpamProtectionActionCreator(createSpamProtection(createScriptLoader()))
        );

        paymentActionCreator = new PaymentActionCreator(
            new PaymentRequestSender(createPaymentClient()),
            orderActionCreator
        );

        payload = merge({}, getOrderRequestBody(), {
            payment: {
                methodId: paymentMethodMock.id,
                gatewayId: paymentMethodMock.gateway,
            },
        });

        loadPaymentMethodAction = of(createAction(PaymentMethodActionType.LoadPaymentMethodSucceeded, paymentMethodMock, { methodId: paymentMethodMock.id }));
        initializePaymentAction = of(createAction(RemoteCheckoutActionType.InitializeRemotePaymentRequested));
        submitOrderAction = of(createAction(OrderActionType.SubmitOrderRequested));
        submitPaymentAction = of(createAction(PaymentActionType.SubmitPaymentRequested));

        jest.spyOn(paymentMethodActionCreator, 'loadPaymentMethod')
            .mockReturnValue(loadPaymentMethodAction);

        jest.spyOn(remoteCheckoutActionCreator, 'initializePayment')
            .mockReturnValue(initializePaymentAction);

        jest.spyOn(orderActionCreator, 'submitOrder')
            .mockReturnValue(submitOrderAction);

        jest.spyOn(paymentActionCreator, 'submitPayment')
            .mockReturnValue(submitPaymentAction);

        jest.spyOn(cardinalClient, 'initialize').mockReturnValue(Promise.resolve());
    });

    describe('#execute', () => {
        describe('with 3ds', () => {
            beforeEach(() => {
                store = createCheckoutStore(getCheckoutStoreStateWithOrder());
                strategy = new PaypalProPaymentStrategy(
                    store,
                    orderActionCreator,
                    new CreditCardCardinalPaymentStrategy(
                        store,
                        paymentMethodActionCreator,
                        orderActionCreator,
                        paymentActionCreator,
                        cardinalClient
                    )
                );

                jest.spyOn(store, 'dispatch');
            });

            it('completes the purchase successfully when 3DS is disabled', async () => {
                const paymentMethod = paymentMethodMock;
                paymentMethod.config.is3dsEnabled = false;

                jest.spyOn(store.getState().paymentMethods, 'getPaymentMethod').mockReturnValue(paymentMethod);

                await strategy.initialize({ methodId: paymentMethod.id });
                await strategy.execute(payload);

                const { payment, ...order } = payload;

                expect(orderActionCreator.submitOrder).toHaveBeenCalledWith(order, undefined);
                expect(paymentActionCreator.submitPayment).toHaveBeenCalledWith(payment);
            });

            it('completes the purchase successfully when 3DS is enabled', async () => {
                const requestError: RequestError = new RequestError(getResponse({
                    ...getErrorPaymentResponseBody(),
                    errors: [
                        { code: 'enrolled_card' },
                    ],
                    three_ds_result: {
                        acs_url: 'https://acs/url',
                        callback_url: '',
                        payer_auth_request: '',
                        merchant_data: 'merchant_data',
                    },
                    status: 'error',
                }));

                jest.spyOn(cardinalClient, 'configure').mockReturnValue(Promise.resolve());
                jest.spyOn(cardinalClient, 'runBindProcess').mockReturnValue(Promise.resolve());
                jest.spyOn(paymentActionCreator, 'submitPayment')
                    .mockReturnValueOnce(of(createErrorAction(PaymentActionType.SubmitPaymentFailed, requestError)));
                jest.spyOn(cardinalClient, 'getThreeDSecureData').mockReturnValue(Promise.resolve('token'));

                await strategy.initialize({ methodId: paymentMethodMock.id });
                const promise = await strategy.execute(payload);

                expect(cardinalClient.getThreeDSecureData).toHaveBeenCalled();
                expect(promise).toBe(store.getState());
            });
        });

        describe('if payment is acknowledged', () => {
            beforeEach(() => {
                state = getCheckoutStoreState();
                store = createCheckoutStore({
                    ...state,
                    checkout: {
                        ...state.checkout,
                        data: getCheckoutWithPayments(),
                    },
                });

                strategy = new PaypalProPaymentStrategy(
                    store,
                    orderActionCreator,
                    new CreditCardCardinalPaymentStrategy(
                        store,
                        paymentMethodActionCreator,
                        orderActionCreator,
                        paymentActionCreator,
                        cardinalClient
                    )
                );

                jest.spyOn(store, 'dispatch');
            });

            it('submits order with payment method name', async () => {
                const payload = getOrderRequestBody();

                await strategy.execute(payload);

                expect(orderActionCreator.submitOrder).toHaveBeenCalledWith({
                    ...payload,
                    payment: { methodId: payload.payment && payload.payment.methodId },
                }, undefined);
                expect(store.dispatch).toHaveBeenCalledWith(submitOrderAction);
            });

            it('does not submit payment separately', async () => {
                const payload = getOrderRequestBody();

                await strategy.execute(payload);

                expect(paymentActionCreator.submitPayment).not.toHaveBeenCalled();
                expect(store.dispatch).not.toHaveBeenCalledWith(submitPaymentAction);
            });
        });
    });
});
