// #region imports
    // #region libraries
    import {
        notifications,
        sitting,
        themes,
    } from '@plurid/plurid-ui-state-react';
    // #endregion libraries


    // #region external
    import modules from '../modules';
    // #endregion external
// #endregion imports



// #region module
const actions = {
    notifications: notifications.actions,
    owner: modules.owner.actions,
    product: modules.product.actions,
    // shortcuts: modules.shortcuts.actions,
    sitting: sitting.actions,
    themes: themes.actions,
    views: modules.views.actions,
};
// #endregion module



// #region exports
export default actions;
// #endregion exports
