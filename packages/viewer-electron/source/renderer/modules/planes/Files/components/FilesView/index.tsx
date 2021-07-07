// #region imports
    // #region libraries
    import {
        Dirent,
    } from 'fs';

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
    import ContextMenu from '../ContextMenu';

    import FilesBlocks from '../FilesBlocks';
    import FilesList from '../FilesList';
    import FilesColumns from '../FilesColumns';
    import FilesGallery from '../FilesGallery';

    import {
        range,
    } from '~renderer-services/utilities/general';
    // #endregion external


    // #region internal
    import {
        StyledFilesView,
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
            pluridLinkNavigation,
            // #endregion values

            // #region methods
            actionClick,
            actionCurrent,
            upLevel,
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
    const renameFile = () => {

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
                />
            )}


            {viewShowAs === 'BLOCKS' && (
                <FilesBlocks
                    theme={theme}
                />
            )}

            {viewShowAs === 'LIST' && (
                <FilesList
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
            )}

            {viewShowAs === 'COLUMNS' && (
                <FilesColumns
                    theme={theme}
                />
            )}

            {viewShowAs === 'GALLERY' && (
                <FilesGallery
                    theme={theme}
                />
            )}
        </StyledFilesView>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default FilesView;
// #endregion exports
