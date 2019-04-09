export default interface KlarnaCredit {
    authorize(params: any, callback: (res: KlarnaAuthorizationResponse) => void): void;
    init(params: KlarnaInitParams): void;
    load(params: KlarnaLoadParams, data: KlarnaUpdateSessionParams | {}, callback?: (res: KlarnaLoadResponse) => void): void;
}

export interface KlarnaInitParams {
    client_token: string;
}

export interface KlarnaLoadParams {
    container: string;
}

export interface KlarnaLoadResponse {
    show_form: boolean;
    error?: {
        invalid_fields: string[];
    };
}

export interface KlarnaAuthorizationResponse {
    authorization_token: string;
    approved: boolean;
    show_form: boolean;
    error?: {
        invalid_fields: string[];
    };
}

export interface KlarnaUpdateSessionParams {
    billing_address: {
        street_address: string,
        city: string,
        country: string,
        given_name: string,
        family_name: string,
        postal_code: string,
        region: string,
        email?: string,
    };
    shipping_address?: {
        street_address: string,
        city: string,
        country: string,
        given_name: string,
        family_name: string,
        postal_code: string,
        region: string,
        email?: string,
    };
}
