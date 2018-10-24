import { Checkout } from '../../../checkout';
import {
    MissingDataError,
    MissingDataErrorType
} from '../../../common/error/errors';
import StandardError from '../../../common/error/errors/standard-error';
import PaymentMethod from '../../payment-method';
import { BraintreeSDKCreator, GooglePayBraintreeSDK } from '../braintree';

import {
    GooglePaymentData,
    GooglePayBraintreeDataRequest,
    GooglePayBraintreePaymentDataRequestV1,
    GooglePayInitializer,
    GooglePayPaymentDataRequestV2,
    TokenizePayload
} from './googlepay';

export default class GooglePayStripeInitializer implements GooglePayInitializer {
    constructor() {}

    initialize(
        checkout: Checkout,
        paymentMethod: PaymentMethod,
        hasShippingAddress: boolean
    ): Promise<GooglePayPaymentDataRequestV2> {
        return this._mapGooglePayBraintreeDataRequestToGooglePayDataRequestV2(
            checkout,
            paymentMethod.initializationData,
            hasShippingAddress);
    }

    teardown(): Promise<void> {
        return Promise.resolve();
    }

    parseResponse(paymentData: GooglePaymentData): Promise<TokenizePayload> {
        try {
            const payload = JSON.parse(paymentData.paymentMethodData.tokenizationData.token);

            return Promise.resolve({
                nonce: payload.id,
                type: payload.type,
                details: {
                    cardType: payload.card.brand,
                    lastFour: payload.card.last4,
                },
            });
        } catch (err) {
            return Promise.reject(err);
        }
    }

    private _mapGooglePayBraintreeDataRequestToGooglePayDataRequestV2(
        checkout: Checkout,
        initializationData: any,
        hasShippingAddress: boolean
    ): Promise<GooglePayPaymentDataRequestV2> {
        const googlePayPaymentDataRequestV2: GooglePayPaymentDataRequestV2 = {
            apiVersion: 2,
            apiVersionMinor: 0,
            merchantInfo: {
                authJwt: initializationData.platformToken,
                merchantId: initializationData.googleMerchantId,
                merchantName: initializationData.googleMerchantName,
            },
            allowedPaymentMethods: [{
                type: 'CARD',
                parameters: {
                    allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
                    allowedCardNetworks: ['AMEX', 'DISCOVER', 'JCB', 'MASTERCARD', 'VISA'],
                    billingAddressRequired: true,
                    billingAddressParameters: {
                        format: 'FULL',
                        phoneNumberRequired: true,
                    },
                },
                tokenizationSpecification: {
                    type: 'PAYMENT_GATEWAY',
                    parameters: {
                        gateway: 'stripe',
                        'stripe:version': '2017-02-14',
                        'stripe:publishableKey': 'pk_test_4MVAAQNxf8R4xfG5geJWltLV',
                        // 'stripe:version': initializationData.stripeVersion,
                        // 'stripe.publishableKey': initializationData.stripePublishableKey,
                    },
                },
            }],
            transactionInfo: {
                currencyCode: checkout.cart.currency.code,
                totalPriceStatus: 'FINAL',
                totalPrice: checkout.grandTotal.toString(),
            },
            emailRequired: true,
            shippingAddressRequired: !hasShippingAddress,
            shippingAddressParameters: {
                phoneNumberRequired: true,
            },
        };

        return Promise.resolve(googlePayPaymentDataRequestV2);
    }
}
