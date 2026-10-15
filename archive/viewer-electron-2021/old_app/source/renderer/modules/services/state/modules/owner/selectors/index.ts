// #region imports
    // #region external
    import {
        AppState,
    } from '../../../store';
    // #endregion external
// #endregion imports



// #region module
const getOwnerID = (state: AppState) => state.owner.id;
const getIdentonym = (state: AppState) => state.owner.identonym;
const getOwnerQueried = (state: AppState) => state.owner.ownerQueried;


const selectors = {
    getOwnerID,
    getIdentonym,
    getOwnerQueried,
};
// #endregion module



// #region exports
export default selectors;
// #endregion exports
