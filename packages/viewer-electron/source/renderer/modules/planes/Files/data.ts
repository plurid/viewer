// #region imports
    // #region libraries
    import {
        Dirent,
    } from 'fs';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #endregion libraries
// #endregion imports



// #region module
export interface FilesViewContainerProperties {
    // #region required
        // #region values
        theme: Theme;
        files: Dirent[];
        viewDirectory: string;
        selectionIndexes: number[];
        cursorOverIndex: number;
        // #endregion values

        // #region methods
        selectionClick: (event: React.MouseEvent, index: number) => void;
        actionClick: (file: Dirent) => void;
        setSelectionIndexes: React.Dispatch<React.SetStateAction<number[]>>;
        setCursorOverIndex: React.Dispatch<React.SetStateAction<number>>;
        setShowContextMenu: React.Dispatch<React.SetStateAction<boolean>>;
        setContextMenuLeft: React.Dispatch<React.SetStateAction<number>>;
        setContextMenuTop: React.Dispatch<React.SetStateAction<number>>;
        // #endregion methods
    // #endregion required
}
// #endregion module
