// #region imports
    // #region internal
    import initialState from '../initial';

    import * as Types from '../types';
    // #endregion internal
// #endregion imports



// #region module
export const setOwner = (
    state: Types.State,
    action: Types.SetOwnerAction,
): Types.State => {
    return {
        ...state,
        ...action.payload,
    };
}


export const unsetOwner = (): Types.State => {
    return {
        ...initialState,
    };
}



const resolvers = {
    setOwner,
    unsetOwner,
};
// #endregion module



// #region exports
export default resolvers;
// #endregion exports
