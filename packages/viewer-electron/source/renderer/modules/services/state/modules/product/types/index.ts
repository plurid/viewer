// #region module
export const SET_PRODUCT = 'SET_PRODUCT';
export interface SetProductAction {
    type: typeof SET_PRODUCT;
    payload: any;
}


export const UNSET_PRODUCT = 'UNSET_PRODUCT';
export interface UnsetProductAction {
    type: typeof UNSET_PRODUCT;
}


export const SET_LANGUAGE = 'SET_LANGUAGE';
export interface SetLanguageAction {
    type: typeof SET_LANGUAGE;
    payload: string;
}


export const SET_FIELD = 'SET_FIELD';
export interface SetFieldPayload {
    field: string;
    data: any;
}
export interface SetFieldAction {
    type: typeof SET_FIELD;
    payload: SetFieldPayload;
}



export interface State {
    ui: {
        toolbars: any;
    },
    language: string;
}


export type Actions =
    | SetProductAction
    | UnsetProductAction
    | SetLanguageAction
    | SetFieldAction;
// #endregion module
