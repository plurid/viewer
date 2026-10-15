// #region imports
    // #region external
    import * as Types from '../types';

    import initialState from '../initial';

    import resolvers from '../resolvers';
    // #endregion external
// #endregion imports



// #region module
const reducer = (
    state: Types.State = initialState,
    action: Types.Actions,
): Types.State => {
    switch(action.type) {
        case Types.SET_VIEW:
            return resolvers.setView(state, action);
        case Types.SET_GENERAL_VIEW:
            return resolvers.setGeneralView(state, action);
        case Types.TOGGLE_CLEAN_MODE:
            return resolvers.toggleCleanMode(state, action);
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
