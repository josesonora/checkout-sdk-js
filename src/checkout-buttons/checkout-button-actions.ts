import { Action } from '@bigcommerce/data-store';

export enum CheckoutButtonActionType {
    InitializeButtonFailed = 'INITIALIZE_BUTTON_FAILED',
    InitializeButtonRequested = 'INITIALIZE_BUTTON_REQUESTED',
    InitializeButtonSucceeded = 'INITIALIZE_BUTTON_SUCCEEDED',

    DeinitializeButtonFailed = 'DEINITIALIZE_BUTTON_FAILED',
    DeinitializeButtonRequested = 'DEINITIALIZE_BUTTON_REQUESTED',
    DeinitializeButtonSucceeded = 'DEINITIALIZE_BUTTON_SUCCEEDED',
}

export type CheckoutButtonAction = InitializeButtonAction | DeinitializeButtonAction;

export type InitializeButtonAction =
    InitializeButtonRequestedAction |
    InitializeButtonSucceededAction |
    InitializeButtonFailedAction;

export type DeinitializeButtonAction =
    DeinitializeButtonRequestedAction |
    DeinitializeButtonSucceededAction |
    DeinitializeButtonFailedAction;

export interface CheckoutButtonActionMeta {
    methodId: string;
}

export interface InitializeButtonRequestedAction extends Action<undefined, CheckoutButtonActionMeta> {
    type: CheckoutButtonActionType.InitializeButtonRequested;
}

export interface InitializeButtonSucceededAction extends Action<undefined, CheckoutButtonActionMeta> {
    type: CheckoutButtonActionType.InitializeButtonSucceeded;
}

export interface InitializeButtonFailedAction extends Action<Error, CheckoutButtonActionMeta> {
    type: CheckoutButtonActionType.InitializeButtonFailed;
}

export interface DeinitializeButtonRequestedAction extends Action<undefined, CheckoutButtonActionMeta> {
    type: CheckoutButtonActionType.DeinitializeButtonRequested;
}

export interface DeinitializeButtonSucceededAction extends Action<undefined, CheckoutButtonActionMeta> {
    type: CheckoutButtonActionType.DeinitializeButtonSucceeded;
}

export interface DeinitializeButtonFailedAction extends Action<Error, CheckoutButtonActionMeta> {
    type: CheckoutButtonActionType.DeinitializeButtonFailed;
}
