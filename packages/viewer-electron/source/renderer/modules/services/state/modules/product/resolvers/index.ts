// #region imports
    // #region internal
    import initialState from '../initial';

    import * as Types from '../types';

    import {
        loadDatabase,
    } from '~renderer-services/database';
    // #endregion internal
// #endregion imports



// #region module
export const setProduct = (
    state: Types.State,
    action: Types.SetProductAction,
): Types.State => {
    return {
        ...state,
        ...action.payload,
    };
}


export const unsetProduct = (): Types.State => {
    return {
        ...initialState,
    };
}


export const setLanguage = (
    state: Types.State,
    action: Types.SetLanguageAction,
): Types.State => {
    return {
        ...state,
        language: action.payload,
    };
}


export const setField = (
    state: Types.State,
    action: Types.SetFieldAction,
): Types.State => {
    const {
        field,
        data,
    } = action.payload;

    const newState = {
        ...state,
    };

    newState[field] = data;

    return newState;
}



const resolvers = {
    setProduct,
    unsetProduct,
    setLanguage,
    setField,
};
// #endregion module



// #region exports
export default resolvers;
// #endregion exports
