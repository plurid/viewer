// #region imports
    // #region libraries
    import {
        combineReducers,
    } from 'redux';

    import {
        notifications,
        sitting,
        themes,
    } from '@plurid/plurid-ui-state-react';
    // #endregion libraries


    // #region external
    import modules from '../../modules';
    // #endregion external
// #endregion imports



// #region module
const rootReducer = combineReducers({
    notifications: notifications.reducer,
    owner: modules.owner.reducer,
    product: modules.product.reducer,
    // shortcuts: modules.shortcuts.reducer,
    sitting: sitting.reducer,
    themes: themes.reducer,
    views: modules.views.reducer,
});
// #endregion module



// #region exports
export default rootReducer;
// #endregion exports
