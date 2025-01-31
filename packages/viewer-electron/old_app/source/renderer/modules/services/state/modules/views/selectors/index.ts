// #region imports
    // #region external
    import {
        AppState,
    } from '../../../store';
    // #endregion external
// #endregion imports



// #region module
const getGeneralView = (state: AppState) => state.views.general;
const getCleanMode = (state: AppState) => state.views.cleanMode;


const selectors = {
    getGeneralView,
    getCleanMode,
};
// #endregion module



// #region exports
export default selectors;
// #endregion exports
