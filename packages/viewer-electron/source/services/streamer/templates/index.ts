// #region module
    // #region internal
    import indexHtml from './indexHtml';
    import notAvailableHtml from './notAvailableHtml';
    import errorHtml from './errorHtml';
    // #endregion internal
// #endregion module



// #region module
const name = 'viewer';

export const indexPage = indexHtml(name);
export const notAvailablePage = notAvailableHtml(name);
export const errorPage = errorHtml(name);
// #endregion module
