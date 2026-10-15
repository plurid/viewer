// #region imports
    // #region libraries
    import React from 'react';
    // #endregion libraries


    // #region external
    import {
        FilesViewContainerProperties,
    } from '../../data';

    import FilesColumn from '../FilesColumn';
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

    const columns: string[] = [];
    // #endregion properties


    // #region render
    return (
        <StyledFilesColumns
            theme={theme}
        >
            {columns.map(column => {
                return (
                    <FilesColumn
                        key={column + Math.random()}
                        theme={theme}
                    />
                );
            })}
        </StyledFilesColumns>
    );
    // #endregion render
});
// #endregion module



// #region exports
export default FilesColumns;
// #endregion exports
