// #region imports
    // #region external
    import * as Types from '../types';
    // #endregion external
// #endregion imports



// #region module
export const setProduct = (
    product: any,
): Types.SetProductAction => {
    return {
        type: Types.SET_PRODUCT,
        payload: product,
    };
}


export const unsetProduct = (): Types.UnsetProductAction => {
    return {
        type: Types.UNSET_PRODUCT,
    };
}


export const setLanguage = (
    payload: string,
): Types.SetLanguageAction => {
    return {
        type: Types.SET_LANGUAGE,
        payload,
    };
}


export const setField = (
    payload: Types.SetFieldPayload,
): Types.SetFieldAction => {
    return {
        type: Types.SET_FIELD,
        payload,
    };
}


export const addPlane = (
    payload: Types.AddPlanePayload,
): Types.AddPlaneAction => {
    return {
        type: Types.ADD_PLANE,
        payload,
    };
}


export const updatePlane = (
    payload: Types.UpdatePlanePayload,
): Types.UpdatePlaneAction => {
    return {
        type: Types.UPDATE_PLANE,
        payload,
    };
}


export const removePlane = (
    payload: Types.RemovePlanePayload,
): Types.RemovePlaneAction => {
    return {
        type: Types.REMOVE_PLANE,
        payload,
    };
}


export const addSpace = (): Types.AddSpaceAction => {
    return {
        type: Types.ADD_SPACE,
    };
}


export const removeSpace = (
    payload: string,
): Types.RemoveSpaceAction => {
    return {
        type: Types.REMOVE_SPACE,
        payload,
    };
}



export const actions = {
    setProduct,
    unsetProduct,
    setLanguage,
    setField,
    addPlane,
    updatePlane,
    removePlane,
    addSpace,
    removeSpace,
};
// #endregion module



// #region exports
export default actions;
// #endregion exports
