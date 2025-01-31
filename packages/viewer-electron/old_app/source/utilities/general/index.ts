// #region imports
    // #region libraries
    import {
        shell,
    } from 'electron';
    // #endregion libraries
// #endregion imports



// #region module
/**
 * Prevent url from loading in the main window.
 *
 * https://stackoverflow.com/a/51131689/6639124
 *
 * @param event
 * @param url
 */
const handleURLNavigation = (
    event: any,
    url: string,
) => {
    if (url !== event.sender.getURL()) {
        event.preventDefault();
        shell.openExternal(url);
    }
}
// #endregion module



// #region exports
export {
    handleURLNavigation,
};
// #endregion exports
