// #region imports
    // #region external
    import * as Types from '../types';
    // #endregion external
// #endregion imports



// #region module
export const setView = (
    payload: Types.SetViewPayload,
): Types.SetViewAction => {
    return {
        type: Types.SET_VIEW,
        payload,
    };
}


export const setGeneralView = (
    view: string,
): Types.SetGeneralViewAction => {
    return {
        type: Types.SET_GENERAL_VIEW,
        payload: view,
    };
}


export const toggleCleanMode = (
    payload?: boolean,
): Types.ToggleCleanModeAction => {
    return {
        type: Types.TOGGLE_CLEAN_MODE,
        payload,
    };
}



const actions = {
    setView,
    setGeneralView,
    toggleCleanMode,
};
// #endregion module



// #region exports
export default actions;
// #endregion exports
