// #region imports
    // #region imports
    import os from 'os';
    // #endregion imports

    // #region external
    import * as Types from '../types';
    // #endregion external
// #endregion imports



// #region module
const isMac = process.platform === 'darwin';

const defaultMacOSFavorites = [
    os.homedir() + '/Desktop',
    os.homedir() + '/Downloads',
    os.homedir() + '/Documents',
    os.homedir() + '/Movies',
    os.homedir() + '/Music',
    os.homedir() + '/Pictures',
    '/Applications',
    os.homedir(),
];


const initialState: Types.State = {
    ui: {
        toolbars: {
            location: 50,
            alwaysShow: true,
            showNames: true,
            scaleIcons: true,
        },
        touchbar: {
            transformType: -1,
            mode: 'left/right',
        },
    },
    language: 'english',
    spaces: [
        {
            id: 'initial',
            name: 'new space',
            order: 0,
            planes: [],
        },
    ],
    activeSpace: 'initial',
    filesFavorites: isMac
        ? defaultMacOSFavorites
        : [],
    filesRecents: [],
    filesShowDirectAccess: true,
    filesShowDirectAccessFavorites: true,
    filesShowDirectAccessRecent: true,
    filesDefaultOpenDirectory: isMac
        ? os.homedir() + '/Downloads'
        : '',
    filesDefaultShowAs: 'LIST',
    filesDefaultPluridLinkNavigation: true,
};
// #endregion module



// #region exports
export default initialState;
// #endregion exports
