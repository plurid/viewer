// #region imports
    // #region libraries
    import React from 'react';
    import {
        createRoot,
    } from 'react-dom/client';
    // #endregion libraries


    // #region external
    import Application from './Application';
    // #endregion external
// #endregion imports



// #region module
const APPLICATION_ID = 'viewer';
const mount = document.getElementById(APPLICATION_ID)!
const root = createRoot(mount);
root.render(
    <Application />,
);
// #endregion module
