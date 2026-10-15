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
const selectors = {
    notifications: notifications.selectors,
    owner: modules.owner.selectors,
    product: modules.product.selectors,
    // shortcuts: modules.shortcuts.selectors,
    sitting: sitting.selectors,
    themes: themes.selectors,
    views: modules.views.selectors,
};
// #endregion module



// #region exports
export default selectors;
// #endregion exports
