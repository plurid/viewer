// #region imports
    // #region external
    import {
        AppState,
    } from '../../../store';
    // #endregion external
// #endregion imports



// #region module
const getProduct = (state: AppState) => state.product;
const getProductUI = (state: AppState) => state.product.ui;
const getLanguage = (state: AppState) => state.product.language;
const getSpaces = (state: AppState) => state.product.spaces;
const getActiveSpace = (state: AppState) => state.product.activeSpace;
const getFilesFavorites = (state: AppState) => state.product.filesFavorites;
const getFilesRecents = (state: AppState) => state.product.filesRecents;
const getFilesShowDirectAccess = (state: AppState) => state.product.filesShowDirectAccess;
const getFilesDefaultOpenDirectory = (state: AppState) => state.product.filesDefaultOpenDirectory;
const getFilesDefaultShowAs = (state: AppState) => state.product.filesDefaultShowAs;
const getFilesDefaultPluridLinkNavigation = (state: AppState) => state.product.filesDefaultPluridLinkNavigation;



const selectors = {
    getProduct,
    getProductUI,
    getLanguage,
    getSpaces,
    getActiveSpace,
    getFilesFavorites,
    getFilesRecents,
    getFilesShowDirectAccess,
    getFilesDefaultOpenDirectory,
    getFilesDefaultShowAs,
    getFilesDefaultPluridLinkNavigation,
};
// #endregion module



// #region exports
export default selectors;
// #endregion exports
