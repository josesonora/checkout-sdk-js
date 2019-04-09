import { BillingAddress } from '../../../billing/';
import BillingAddressState from '../../../billing/billing-address-state';

import { KlarnaUpdateSessionParams } from './klarna-credit';
import {getConsignmentsState} from "../../../shipping/consignments.mock";
import {getCountriesState} from "../../../geography/countries.mock";
import {getCheckoutButtonState} from "../../../checkout-buttons/checkout-buttons.mock";
import {getPaymentState} from "../../payments.mock";
import {getCartState} from "../../../cart/carts.mock";
import {getCustomerState} from "../../../customer/customers.mock";
import {getCheckoutState} from "../../../checkout/checkouts.mock";
import {getConfigState} from "../../../config/configs.mock";
import {getCustomerStrategyState} from "../../../customer/internal-customers.mock";
import {getShippingCountriesState} from "../../../shipping/shipping-countries.mock";
import {getGiftCertificatesState} from "../../../coupon/gift-certificates.mock";
import {getInstrumentsState} from "../../instrument/instrument.mock";
import CheckoutStoreState from "../../../checkout/checkout-store-state";
import {getCouponsState} from "../../../coupon/coupons.mock";
import {getPaymentMethodsState} from "../../payment-methods.mock";
import {getRemoteCheckoutState} from "../../../remote-checkout/remote-checkout.mock";

export function getCheckoutEUStoreState(): CheckoutStoreState {
    return {
        billingAddress: getEUBillingAddressState(),
        cart: getCartState(),
        checkout: getCheckoutState(),
        checkoutButton: getCheckoutButtonState(),
        config: getConfigState(),
        consignments: getConsignmentsState(),
        countries: getCountriesState(),
        coupons: getCouponsState(),
        customer: getCustomerState(),
        customerStrategies: getCustomerStrategyState(),
        giftCertificates: getGiftCertificatesState(),
        instruments: getInstrumentsState(),
        order: { errors: {}, statuses: {} },
        payment: getPaymentState(),
        paymentMethods: getPaymentMethodsState(),
        paymentStrategies: { data: {}, errors: {}, statuses: {} },
        remoteCheckout: getRemoteCheckoutState(),
        shippingCountries: getShippingCountriesState(),
        shippingStrategies: { data: {}, errors: {}, statuses: {} },
    };
}

export function getKlarnaUpdateSessionParams(): KlarnaUpdateSessionParams {
    return {
        billing_address: {
            street_address: '12345 Testing Way',
            city: 'Some City',
            country: 'DE',
            given_name: 'Test',
            family_name: 'Tester',
            postal_code: '95555',
            region: 'Berlin',
            email: 'test@bigcommerce.com',
        },
        shipping_address: {
            street_address: '12345 Testing Way',
            city: 'Some City',
            country: 'DE',
            given_name: 'Test',
            family_name: 'Tester',
            postal_code: '95555',
            region: 'Berlin',
            email: 'test@bigcommerce.com',
        },
    };
}

export function getEUBillingAddressState(): BillingAddressState {
    return {
        data: getBillingAddress(),
        errors: {},
        statuses: {},
    };
}

function getBillingAddress(): BillingAddress {
    return {
        id: '55c96cda6f04c',
        firstName: 'Test',
        lastName: 'Tester',
        email: 'test@bigcommerce.com',
        company: 'Bigcommerce',
        address1: '12345 Testing Way',
        address2: '',
        city: 'Some City',
        stateOrProvince: 'Berlin',
        stateOrProvinceCode: 'CA',
        country: 'Germany',
        countryCode: 'DE',
        postalCode: '95555',
        phone: '555-555-5555',
        customFields: [],
    };
}
