// #region imports
    // #region external
    import * as Types from '../types';
    // #endregion external
// #endregion imports



// #region module
export const setView = (
    state: Types.State,
    action: Types.SetViewAction,
): Types.State => {
    const {
        payload,
    } = action;

    const newState = {
        ...state,
    };

    const {
        type,
        data,
    } = payload;

    newState[type] = data;

    return {
        ...newState,
    };
}


export const setGeneralView = (
    state: Types.State,
    action: Types.SetGeneralViewAction,
): Types.State => {
    return {
        ...state,
        general: action.payload,
    };
}


export const toggleCleanMode = (
    state: Types.State,
    action: Types.ToggleCleanModeAction,
): Types.State => {
    const cleanMode = typeof action.payload === 'boolean'
        ? action.payload
        : !state.cleanMode;

    return {
        ...state,
        cleanMode,
    };
}



const resolvers = {
    setView,
    setGeneralView,
    toggleCleanMode,
};
// #endregion module



// #region exports
export default resolvers;
// #endregion exports
