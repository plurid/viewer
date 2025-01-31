// #region imports
    // #region libraries
    import os from 'os';
    import path from 'path';

    import Datastore from 'nedb';
    // #endregion libraries
// #endregion imports



// #region module
const loadDatabase = () => {
    const homeDirectory = os.homedir();

    const generalDatabasePath = path.join(
        homeDirectory,
        '.viewer/datastore.general',
    );

    const general = new Datastore({
        filename: generalDatabasePath,
        autoload: true,
    });

    const database = {
        general,
    };

    return database;
}

const database = loadDatabase();
// #endregion module



// #region exports
export {
    loadDatabase,
    database,
};
// #endregion exports
