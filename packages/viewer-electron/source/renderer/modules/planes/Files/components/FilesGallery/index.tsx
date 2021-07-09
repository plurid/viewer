// #region imports
    // #region libraries
    import React from 'react';
    // #endregion libraries


    // #region external
    import {
        FilesViewContainerProperties,
    } from '../../data';

    import FileGalleryView from '../FileGalleryView';
    import FilesBlockRow from '../FilesBlockRow';
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

    const selected = files[0];
    // #endregion properties


    // #region render
    return (
        <StyledFilesGallery
            theme={theme}
        >
            <FileGalleryView
                theme={theme}
                selected={selected}
            />

            <FilesBlockRow
                theme={theme}
                files={files}
                viewDirectory={viewDirectory}
                selectionIndexes={selectionIndexes}

                selectionClick={selectionClick}
                actionClick={actionClick}
                setCursorOverIndex={setCursorOverIndex}
            />
        </StyledFilesGallery>
    );
    // #endregion render
});
// #endregion module



// #region exports
export default FilesGallery;
// #endregion exports
