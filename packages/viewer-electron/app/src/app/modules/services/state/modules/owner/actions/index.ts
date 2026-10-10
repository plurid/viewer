// #region imports
    // #region external
    import * as Types from '../types';
    // #endregion external
// #endregion imports



// #region module
export const setOwner = (
    user: any,
): Types.SetOwnerAction => {
    return {
        type: Types.SET_OWNER,
        payload: user,
    };
}


export const unsetOwner = (): Types.UnsetOwnerAction => {
    return {
        type: Types.UNSET_OWNER,
    };
}



const actions = {
    setOwner,
    unsetOwner,
};
// #endregion module



// #region exports
export default actions;
// #endregion exports
