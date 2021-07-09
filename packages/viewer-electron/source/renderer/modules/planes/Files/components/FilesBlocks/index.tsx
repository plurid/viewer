// #region imports
    // #region libraries
    import React from 'react';
    // #endregion libraries


    // #region external
    import {
        FilesViewContainerProperties,
    } from '../../data';

    import FileBlock from '../FileBlock';
    // #endregion external


    // #region internal
    import {
        StyledFilesBlocks,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
const FilesBlocks = React.forwardRef<
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
        <StyledFilesBlocks
            theme={theme}
        >
            {files.map((file, index) => {
                return (
                    <FileBlock
                        key={Math.random() + ''}
                        path={viewDirectory}
                        file={file}
                        theme={theme}
                        index={index}
                        selected={selectionIndexes.includes(index)}

                        selectionClick={selectionClick}
                        actionClick={actionClick}
                        setCursorOverIndex={setCursorOverIndex}
                    />
                );
            })}
        </StyledFilesBlocks>
    );
    // #endregion render
});
// #endregion module



// #region exports
export default FilesBlocks;
// #endregion exports
