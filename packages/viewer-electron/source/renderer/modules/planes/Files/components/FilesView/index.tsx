// #region imports
    // #region libraries
    import path from 'path';

    import {
        Dirent,
    } from 'fs';

    import * as remote from '@electron/remote';

    import React, {
        useRef,
        useState,
        useEffect,
    } from 'react';


    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #endregion libraries


    // #region external
    import {
        FilesViewContainerProperties,
    } from '../../data';

    import ContextMenu from '../ContextMenu';

    import FilesBlocks from '../FilesBlocks';
    import FilesList from '../FilesList';
    import FilesColumns from '../FilesColumns';
    import FilesGallery from '../FilesGallery';

    import {
        range,
    } from '~renderer-services/utilities/general';

    import {
        deleteFile,
        deleteFolder,
    } from '~renderer-services/logic/files';
    // #endregion external


    // #region internal
    import {
        StyledFilesView,
        StyledFilesNotFound,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
export interface FilesViewProperties {
    // #region required
        // #region values
        theme: Theme;
        files: Dirent[];
        viewDirectory: string;
        viewShowAs: string;
        viewError: string;
        pluridLinkNavigation: boolean;
        // #endregion values

        // #region methods
        actionClick: (
            file: Dirent,
        ) => void;
        actionCurrent: (
            selection: number[],
        ) => void;
        upLevel: () => void;
        addStream: (
            filepath: string,
        ) => void;
        // #endregion methods
    // #endregion required
}

const FilesView: React.FC<FilesViewProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region required
            // #region values
            theme,
            files,
            viewDirectory,
            viewShowAs,
            viewError,
            pluridLinkNavigation,
            // #endregion values

            // #region methods
            actionClick,
            actionCurrent,
            upLevel,
            addStream,
            // #endregion methods
        // #endregion required
    } = properties;
    // #endregion properties


    // #region references
    const node = useRef<HTMLDivElement | null>(null);
    // #endregion references


    // #region state
    const [
        cursorOverIndex,
        setCursorOverIndex,
    ] = useState<number>(-1);

    const [
        selectionIndexes,
        setSelectionIndexes,
    ] = useState<number[]>([]);

    const [
        selectionDirection,
        setSelectionDirection,
    ] = useState('');

    const [
        showContextMenu,
        setShowContextMenu,
    ] = useState(false);

    const [
        contextMenuLeft,
        setContextMenuLeft,
    ] = useState(0);

    const [
        contextMenuTop,
        setContextMenuTop,
    ] = useState(0);
    // #endregion state


    // #region handlers
    const getSelectedFiles = () => {
        const selectedFiles: Dirent[] = [];

        for (const selectionIndex of selectionIndexes) {
            const file = files[selectionIndex];
            selectedFiles.push(file);
        }

        return selectedFiles;
    }

    const renameFile = () => {
        if (selectionIndexes.length > 1) {
            return;
        }
    }

    const deleteSelectedFiles = () => {
        const selectedFiles = getSelectedFiles();

        for (const selectedFile of selectedFiles) {
            const filepath = path.join(
                viewDirectory,
                selectedFile.name,
            );

            if (selectedFile.isFile()) {
                deleteFile(filepath);
                return;
            }

            deleteFolder(filepath);
        }

        setSelectionIndexes([]);
    }

    const selectionClick = (
        event: React.MouseEvent,
        index: number,
    ) => {
        if (
            !event.shiftKey
            && !(event.metaKey || event.ctrlKey)
        ) {
            if (
                selectionIndexes.includes(index)
                && selectionIndexes.length === 1
            ) {
                setSelectionIndexes([]);
                return;
            }

            if (
                selectionIndexes.includes(index)
                && selectionIndexes.length > 1
            ) {
                setSelectionIndexes([index]);
                return;
            }

            setSelectionIndexes([
                index,
            ]);
            return;
        }

        if (
            event.metaKey
            || event.ctrlKey
        ) {
            if (selectionIndexes.includes(index)) {
                const newSelectionIndexes = selectionIndexes.filter(idx => idx !== index);
                setSelectionIndexes(newSelectionIndexes);
                return;
            }

            setSelectionIndexes([
                ...selectionIndexes,
                index,
            ]);
            return;
        }

        if (
            event.shiftKey
        ) {
            if (selectionIndexes.length === 0) {
                const values = range(0, index);
                setSelectionIndexes([
                    ...values,
                ]);
                return;
            }

            const lowestIndex = Math.min(...selectionIndexes);
            const highestIndex = Math.max(...selectionIndexes);

            if (index < lowestIndex) {
                const values = range(index, highestIndex);
                setSelectionIndexes([
                    ...values,
                ]);
                return;
            }

            if (highestIndex < index) {
                const values = range(lowestIndex, index);
                setSelectionIndexes([
                    ...values,
                ]);
                return;
            }

            if (
                lowestIndex <= index
                && index <= highestIndex
            ) {
                const values = range(lowestIndex, index);
                setSelectionIndexes([
                    ...values,
                ]);
                return;
            }
        }
    }

    const streamFile = () => {
        const selected = getSelectedFiles();
        const file = selected[0];
        if (!file) {
            return;
        }

        const filepath = path.join(
            viewDirectory,
            file.name,
        );

        const url = file.name;

        const streamer = remote.getGlobal('streamer');
        streamer.add(
            url,
            filepath,
        );

        addStream(
            filepath,
        );

        setShowContextMenu(false);
    }

    const handleNavigation = (
        event: KeyboardEvent,
        stopEvent: () => void,
    ) => {
        const lowestIndex = Math.min(...selectionIndexes);
        const highestIndex = Math.max(...selectionIndexes);

        const previousItem = lowestIndex - 1 >= 0
            ? lowestIndex - 1
            : lowestIndex;

        const nextItem = highestIndex + 1 < files.length
            ? highestIndex + 1
            : highestIndex;

        if (event.key === 'ArrowUp') {
            stopEvent();

            if (
                event.shiftKey
                && event.altKey
            ) {
                const values = range(previousItem, highestIndex);
                setSelectionIndexes([
                    ...values,
                ]);
                return true;
            }

            if (
                event.shiftKey
            ) {
                if (
                    selectionIndexes.length === 1
                    || selectionDirection === 'UP'
                ) {
                    setSelectionDirection('UP');
                    const values = range(previousItem, highestIndex);
                    setSelectionIndexes([
                        ...values,
                    ]);
                    return true;
                }

                const values = range(lowestIndex, highestIndex - 1);
                setSelectionIndexes([
                    ...values,
                ]);
                return true;
            }

            setSelectionIndexes([
                previousItem,
            ]);
            return true;
        }

        if (event.key === 'ArrowDown') {
            stopEvent();

            if (event.shiftKey) {
                if (
                    selectionIndexes.length === 1
                    || selectionDirection === 'DOWN'
                ) {
                    setSelectionDirection('DOWN');
                    const values = range(lowestIndex, nextItem);
                    setSelectionIndexes([
                        ...values,
                    ]);
                    return true;
                }

                const values = range(lowestIndex + 1, highestIndex);
                setSelectionIndexes([
                    ...values,
                ]);
                return true;
            }

            setSelectionIndexes([
                nextItem,
            ]);
            return true;
        }

        return false;
    }

    const handleKeyDown = (
        event: KeyboardEvent,
    ) => {
        const stopEvent = () => {
            event.preventDefault();
            event.stopPropagation();
        }


        if (
            event.key === 'ArrowDown'
            && (event.metaKey || event.ctrlKey)
        ) {
            stopEvent();
            actionCurrent(selectionIndexes);
            return;
        }

        if (
            event.key === 'ArrowUp'
            && (event.metaKey || event.ctrlKey)
        ) {
            stopEvent();
            upLevel();
            return;
        }


        if (
            event.key === 'Enter'
        ) {
            stopEvent();
            renameFile();
            return;
        }


        if (
            event.key === 'Backspace'
            && (event.metaKey || event.ctrlKey)
        ) {
            stopEvent();
            deleteSelectedFiles();
            return;
        }


        const handledByNavigation = handleNavigation(event, stopEvent);
        if (handledByNavigation) {
            return;
        }
    }
    // #endregion handlers


    // #region effects
    useEffect(() => {
        if (!node.current) {
            return;
        }

        node.current.addEventListener('keydown', handleKeyDown);

        return () => {
            if (!node.current) {
                return;
            }

            node.current.removeEventListener('keydown', handleKeyDown);
        }
    }, [
        selectionIndexes,
    ]);
    // #endregion effects


    // #region render
    let FilesViewContainer = React.forwardRef<
        any,
        FilesViewContainerProperties
    >(
        () => (<></>),
    );
    switch (viewShowAs) {
        case 'BLOCKS':
            FilesViewContainer = FilesBlocks;
            break;
        case 'LIST':
            FilesViewContainer = FilesList;
            break;
        case 'COLUMNS':
            FilesViewContainer = FilesColumns;
            break;
        case 'GALLERY':
            FilesViewContainer = FilesGallery;
            break;
    }

    return (
        <StyledFilesView
            theme={theme}
        >
            {showContextMenu && (
                <ContextMenu
                    theme={theme}
                    left={contextMenuLeft}
                    top={contextMenuTop}
                    viewDirectory={viewDirectory}
                    selectionIndexes={selectionIndexes}
                    files={files}

                    closeMenu={() => setShowContextMenu(false)}
                    deleteSelectedFiles={deleteSelectedFiles}
                    streamFile={streamFile}
                />
            )}

            {viewError === 'NOT_FOUND'
            && (
                <StyledFilesNotFound>
                    path not found
                </StyledFilesNotFound>
            )}

            {files.length === 0
            && viewError === ''
            && (
                <StyledFilesNotFound>
                    no files
                </StyledFilesNotFound>
            )}

            {files.length > 0
            && (
                <>
                    <FilesViewContainer
                        ref={node}

                        theme={theme}
                        files={files}
                        viewDirectory={viewDirectory}
                        selectionIndexes={selectionIndexes}
                        cursorOverIndex={cursorOverIndex}

                        selectionClick={selectionClick}
                        actionClick={actionClick}
                        setSelectionIndexes={setSelectionIndexes}
                        setCursorOverIndex={setCursorOverIndex}
                        setShowContextMenu={setShowContextMenu}
                        setContextMenuLeft={setContextMenuLeft}
                        setContextMenuTop={setContextMenuTop}
                    />
                </>
            )}
        </StyledFilesView>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default FilesView;
// #endregion exports
