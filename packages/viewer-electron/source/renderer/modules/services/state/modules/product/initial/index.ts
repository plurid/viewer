// #region imports
    // #region external
    import * as Types from '../types';
    // #endregion external
// #endregion imports



// #region module
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
    filesFavorites: [],
    filesRecents: [],
    filesShowDirectAccess: true,
};
// #endregion module



// #region exports
export default initialState;
// #endregion exports
