// #region imports
    // #region libraries
    import React from 'react';
    // #endregion libraries


    // #region external
    import {
        FilesViewContainerProperties,
    } from '../../data';

    import FileItem from '../FileItem';
    // #endregion external


    // #region internal
    import {
        StyledFilesList,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
const FilesList = React.forwardRef<
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
        <StyledFilesList
            ref={node}
            theme={theme}
            onClick={(event) => {
                setShowContextMenu(false);

                if (event.target === (node as any).current) {
                    setSelectionIndexes([]);
                }
            }}
            onContextMenu={(event) => {
                if (!(node as any).current) {
                    return;
                }

                event.preventDefault();

                setShowContextMenu(true);

                const rect = (node as any).current.getBoundingClientRect();
                const left = event.clientX - rect.left;
                const top = event.clientY - rect.top;

                setContextMenuLeft(left);
                setContextMenuTop(top);

                if (!selectionIndexes.includes(cursorOverIndex)) {
                    setSelectionIndexes([cursorOverIndex]);
                }
            }}
            tabIndex={1}
            style={{
                outline: 'none',
            }}
        >
            {files.map((file, index) => {
                return (
                    <FileItem
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
        </StyledFilesList>
    );
    // #endregion render
});
// #endregion module



// #region exports
export default FilesList;
// #endregion exports
