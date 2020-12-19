// #region imports
    // #region libraries
    import {
        remote,
    } from 'electron';

    import Datastore from 'nedb';
    // #endregion libraries
// #endregion imports



// #region module
export interface Database {
    general: Datastore;
    recipes: Datastore;
}

const loadDatabase = () => {
    return remote.getGlobal('loadDatabase')() as Database;
}
// #endregion module



// #region exports
export {
    loadDatabase,
};
// #endregion exports
