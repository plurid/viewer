// #region imports
    // #region libraries
    import {
        combineReducers,
    } from '@reduxjs/toolkit';
    // #endregion libraries


    // #region external
    import modules from '../../modules';
    // #endregion external
// #endregion imports



// #region module
const reducer = combineReducers({
    notifications: modules.notifications.reducer,
    owner: modules.owner.reducer,
    product: modules.product.reducer,
    // shortcuts: modules.shortcuts.reducer,
    sitting: modules.sitting.reducer,
    themes: modules.themes.reducer,
    views: modules.views.reducer,
});
// #endregion module



// #region exports
export type AppState = ReturnType<typeof reducer>;


export default reducer;
// #endregion exports
