// #region imports
    // #region libraries
    import React from 'react';
    // #endregion libraries


    // #region external
    import {
        FilesViewContainerProperties,
    } from '../../data';
    // #endregion external


    // #region internal
    import {
        StyledFilesGallery,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
const FilesGallery = React.forwardRef<
    any,
    FilesViewContainerProperties
>((
    properties,
    node,
) => {
    // #region properties
    const {
        // #region required
            // #region values
            theme,
            files,
            viewDirectory,
            selectionIndexes,
            cursorOverIndex,
            // #endregion values

            // #region methods
            selectionClick,
            actionClick,
            setSelectionIndexes,
            setCursorOverIndex,
            setShowContextMenu,
            setContextMenuLeft,
            setContextMenuTop,
            // #endregion methods
        // #endregion required
    } = properties;
    // #endregion properties


    // #region render
    return (
        <StyledFilesGallery
            theme={theme}
        >
            FilesGallery
        </StyledFilesGallery>
    );
    // #endregion render
});
// #endregion module



// #region exports
export default FilesGallery;
// #endregion exports
