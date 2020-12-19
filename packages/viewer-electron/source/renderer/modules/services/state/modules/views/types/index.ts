// #region imports
    // #region external
    // #endregion external
// #endregion imports



// #region module
export const SET_VIEW = 'SET_VIEW';
export interface SetViewPayload {
    type: string;
    data: any;
}
export interface SetViewAction {
    type: typeof SET_VIEW;
    payload: SetViewPayload;
}


export const SET_GENERAL_VIEW = 'SET_GENERAL_VIEW';
export interface SetGeneralViewAction {
    type: typeof SET_GENERAL_VIEW;
    payload: string;
}


export const TOGGLE_CLEAN_MODE = 'TOGGLE_CLEAN_MODE';
export interface ToggleCleanModeAction {
    type: typeof TOGGLE_CLEAN_MODE;
    payload?: boolean;
}



export interface State {
    general: string;
    loading: boolean;
    cleanMode: boolean;
}


export type Actions =
    | SetViewAction
    | SetGeneralViewAction
    | ToggleCleanModeAction;
// #endregion module
