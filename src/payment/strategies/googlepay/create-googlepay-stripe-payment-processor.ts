import { createRequestSender } from '@bigcommerce/request-sender';
import { ScriptLoader } from '@bigcommerce/script-loader';

import { PaymentMethodActionCreator, PaymentMethodRequestSender } from '../..';
import { BillingAddressActionCreator, BillingAddressRequestSender } from '../../../billing';
import { CheckoutStore } from '../../../checkout';

import { GooglePayPaymentProcessor, GooglePayScriptLoader, GooglePayStripeInitializer } from '.';

export default function createGooglePayStripePaymentProcessor(
    store: CheckoutStore,
    scriptLoader: ScriptLoader): GooglePayPaymentProcessor {

    const requestSender = createRequestSender();
    const paymentMethodActionCreator = new PaymentMethodActionCreator(new PaymentMethodRequestSender(requestSender));
    const billingAddressActionCreator = new BillingAddressActionCreator(new BillingAddressRequestSender(requestSender));

    return new GooglePayPaymentProcessor(
        store,
        paymentMethodActionCreator,
        new GooglePayScriptLoader(scriptLoader),
        new GooglePayStripeInitializer(),
        billingAddressActionCreator,
        requestSender
    );
}
