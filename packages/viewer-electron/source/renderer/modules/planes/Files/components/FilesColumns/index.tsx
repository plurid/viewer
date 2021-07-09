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
        StyledFilesColumns,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
const FilesColumns = React.forwardRef<
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
        <StyledFilesColumns
            theme={theme}
        >
            FilesColumns
        </StyledFilesColumns>
    );
    // #endregion render
});
// #endregion module



// #region exports
export default FilesColumns;
// #endregion exports
