// #region imports
    // #region external
    import {
        Space,
        RecordFilesStreams,
    } from '~renderer-data/interfaces';
    // #endregion external
// #endregion imports



// #region module
export interface State {
    ui: {
        toolbars: any;
        touchbar: {
            transformType: number;
            mode: string;
        };
    };
    language: string;
    spaces: Space[];
    activeSpace: string;
    filesFavorites: string[];
    filesRecents: string[];
    filesRecentsLength: number;
    filesShowDirectAccess: boolean;
    filesShowDirectAccessFavorites: boolean;
    filesShowDirectAccessRecent: boolean;
    filesDefaultOpenDirectory: string;
    filesDefaultShowAs: string;
    filesDefaultPluridLinkNavigation: boolean;
    filesStreams: RecordFilesStreams;
}
// #endregion module
