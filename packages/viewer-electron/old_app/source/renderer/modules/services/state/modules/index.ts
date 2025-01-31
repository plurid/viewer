// #region imports
    // #region libraries
    import {
        notifications as notificationsState,
        sitting as sittingState,
        themes as themesState,
    } from '@plurid/plurid-ui-state-react';
    // #endregion libraries


    // #region internal
    import * as owner from './owner';
    import * as product from './product';
    import * as views from './views';
    // #endregion internal
// #endregion imports



// #region module
const notifications = notificationsState.factory();;
const sitting = sittingState.factory();
const themes = themesState.factory();
// #endregion module



// #region exports
export default {
    owner,
    product,
    views,
    notifications,
    sitting,
    themes,
};
// #endregion exports
