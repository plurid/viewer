// #region imports
    // #region libraries
    import {
        Dirent,
    } from 'fs';

    import React, {
        useRef,
        useState,
    } from 'react';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #endregion libraries


    // #region external
    import FileItem from '../FileItem';
    // #endregion external


    // #region internal
    import {
        StyledFilesView,
        StyledFilesSelection,
        StyledFilesList,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
const range = (
    start: number,
    end: number,
) => {
    return Array.from(
        {
            length: end - start + 1,
        },
        (_, k) => k + start,
    );
}


export interface FilesViewProperties {
    // #region required
        // #region values
        theme: Theme;
        files: Dirent[];
        viewDirectory: string;
        // #endregion values

        // #region methods
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
            // #endregion values

            // #region methods
            // #endregion methods
        // #endregion required
    } = properties;
    // #endregion properties


    // #region references
    const node = useRef<HTMLDivElement | null>(null);
    // #endregion references


    // #region state
    const [
        selectionIndexes,
        setSelectionIndexes,
    ] = useState<number[]>([]);
    // #endregion state


    // #region handlers
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

    const handleKeyDown = (
        event: React.KeyboardEvent,
    ) => {
        const lowestIndex = Math.min(...selectionIndexes);
        const highestIndex = Math.max(...selectionIndexes);

        if (event.code === 'ArrowUp') {
            event.preventDefault();

            const previousItem = lowestIndex - 1 >= 0
                ? highestIndex - 1
                : highestIndex;

            if (event.shiftKey) {
                const values = range(previousItem, highestIndex);
                setSelectionIndexes([
                    ...values,
                ]);
                return;
            }

            setSelectionIndexes([
                previousItem,
            ]);
            return;
        }

        if (event.code === 'ArrowDown') {
            event.preventDefault();

            const nextItem = highestIndex + 1 < files.length
                ? highestIndex + 1
                : highestIndex;

            if (event.shiftKey) {
                const values = range(lowestIndex, nextItem);
                setSelectionIndexes([
                    ...values,
                ]);
                return;
            }

            setSelectionIndexes([
                nextItem,
            ]);
            return;
        }
    }
    // #endregion handlers


    // #region render
    return (
        <StyledFilesView
            theme={theme}
        >
            <StyledFilesList
                ref={node}
                theme={theme}
                onClick={(event) => {
                    if (event.target === node.current) {
                        setSelectionIndexes([]);
                    }
                }}
                onKeyDown={(event) => handleKeyDown(event)}
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
                        />
                    );
                })}
            </StyledFilesList>
        </StyledFilesView>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default FilesView;
// #endregion exports
