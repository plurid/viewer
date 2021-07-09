// #region imports
    // #region libraries
    import React from 'react';
    // #endregion libraries


    // #region external
    import {
        FilesViewContainerProperties,
    } from '../../data';

    import FilesBlockRow from '../FilesBlockRow';
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

    const rowLength = 5;
    const rowsCount = Math.ceil(files.length / rowLength);
    const rows = Array.from({length: rowsCount}, (_, i) => i);
    // #endregion properties


    // #region render
    return (
        <StyledFilesBlocks
            theme={theme}
        >
            {rows.map(row => {
                const emptyArray = Array.from({length: rowLength}, (_, i) => i);
                const rowsFiles = emptyArray
                    .map(index => {
                        const fileIndex = index + row * rowLength;
                        return files[fileIndex];
                    })
                    .filter(file => !!file);

                return (
                    <FilesBlockRow
                        key={viewDirectory + 'row' + row + Math.random()}
                        theme={theme}
                        files={rowsFiles}
                        viewDirectory={viewDirectory}
                        selectionIndexes={selectionIndexes}

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
