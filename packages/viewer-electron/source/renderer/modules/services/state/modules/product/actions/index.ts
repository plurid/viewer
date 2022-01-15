// #region imports
    // #region external
    import * as Types from '../types';
    // #endregion external
// #endregion imports



// #region module
const setProduct = (
    product: any,
): Types.SetProductAction => {
    return {
        type: Types.SET_PRODUCT,
        payload: product,
    };
}


const unsetProduct = (): Types.UnsetProductAction => {
    return {
        type: Types.UNSET_PRODUCT,
    };
}


const setLanguage = (
    payload: string,
): Types.SetLanguageAction => {
    return {
        type: Types.SET_LANGUAGE,
        payload,
    };
}


const setField = (
    payload: Types.SetFieldPayload,
): Types.SetFieldAction => {
    return {
        type: Types.SET_FIELD,
        payload,
    };
}


const addPlane = (
    payload: Types.AddPlanePayload,
): Types.AddPlaneAction => {
    return {
        type: Types.ADD_PLANE,
        payload,
    };
}


const updatePlane = (
    payload: Types.UpdatePlanePayload,
): Types.UpdatePlaneAction => {
    return {
        type: Types.UPDATE_PLANE,
        payload,
    };
}


const removePlane = (
    payload: Types.RemovePlanePayload,
): Types.RemovePlaneAction => {
    return {
        type: Types.REMOVE_PLANE,
        payload,
    };
}


const addSpace = (): Types.AddSpaceAction => {
    return {
        type: Types.ADD_SPACE,
    };
}


const removeSpace = (
    payload: string,
): Types.RemoveSpaceAction => {
    return {
        type: Types.REMOVE_SPACE,
        payload,
    };
}


const addStream = (
    payload: Types.AddStreamPayload,
): Types.AddStreamAction => {
    return {
        type: Types.ADD_STREAM,
        payload,
    };
}



const actions = {
    setProduct,
    unsetProduct,
    setLanguage,
    setField,
    addPlane,
    updatePlane,
    removePlane,
    addSpace,
    removeSpace,
    addStream,
};
// #endregion module



// #region exports
export default actions;
// #endregion exports
