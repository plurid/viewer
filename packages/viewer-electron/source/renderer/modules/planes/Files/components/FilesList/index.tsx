// #region imports
    // #region libraries
    import {
        Dirent,
    } from 'fs';

    import React from 'react';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #endregion libraries


    // #region external
    import FileItem from '../FileItem';
    // #endregion external


    // #region internal
    import {
        StyledFilesList,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
export interface FilesListProperties {
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

const FilesList = React.forwardRef<
    any,
    FilesListProperties
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
