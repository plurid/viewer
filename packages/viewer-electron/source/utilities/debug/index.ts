// #region imports
    // #region libraries
    import {
        promises as fs,
    } from 'fs';

    import path from 'path';
    import os from 'os';
    // #endregion libraries
// #endregion imports



// #region module
const DEBUG_FILE = path.join(os.homedir(), '.viewer/debug');

const debug = (
    ...text: any[]
) => {
    fs.appendFile(DEBUG_FILE, text.join(' ') + '\n');
}
// #endregion module



// #region exports
export default debug;
// #endregion exports
