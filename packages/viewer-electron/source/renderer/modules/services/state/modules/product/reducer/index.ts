// #region imports
    // #region external
    import * as Types from '../types';

    import initialState from '../initial';

    import resolvers from '../resolvers';
    // #endregion external
// #endregion imports



// #region module
export const reducer = (
    state: Types.State = initialState,
    action: Types.Actions,
): Types.State => {
    switch(action.type) {
        case Types.SET_PRODUCT:
            return resolvers.setProduct(state, action);
        case Types.UNSET_PRODUCT:
            return resolvers.unsetProduct();
        case Types.SET_LANGUAGE:
            return resolvers.setLanguage(state, action);
        case Types.SET_FIELD:
            return resolvers.setField(state, action);
        default:
            return {
                ...state,
            };
    }
}
// #endregion module



// #region exports
export default reducer;
// #endregion exports
