// #region imports
    // #region imports
    import {
        uuid,
    } from '@plurid/plurid-functions';
    // #endregion imports


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
    },
    language: 'english',
    spaces: [
        {
            id: uuid.generate(),
            planes: [
                {
                    id: uuid.generate(),
                    kind: 'image',
                    data: {
                        source: 'https://raw.githubusercontent.com/plurid/enhanced-image/master/about/assets/identity/enhanced-image-logo.png',
                    },
                }
            ],
        },
    ],
};
// #endregion module



// #region exports
export default initialState;
// #endregion exports
