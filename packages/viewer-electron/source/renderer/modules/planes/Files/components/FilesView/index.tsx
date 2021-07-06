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
        selecting,
        setSelecting,
    ] = useState(false);

    const [
        selectionIndexes,
        setSelectionIndexes,
    ] = useState<number[]>([]);

    // const [
    //     selectionTop,
    //     setSelectionTop,
    // ] = useState(0);
    // const [
    //     selectionLeft,
    //     setSelectionLeft,
    // ] = useState(0);
    // const [
    //     selectionWidth,
    //     setSelectionWidth,
    // ] = useState(0);
    // const [
    //     selectionHeight,
    //     setSelectionHeight,
    // ] = useState(0);
    // #endregion state


    // #region handlers
    // const handleSelection = (
    //     event: React.MouseEvent<HTMLDivElement>,
    // ) => {
    //     if (!selecting) {
    //         return;
    //     }

    //     if (!node.current) {
    //         return;
    //     }

    //     const rect = node.current.getBoundingClientRect();
    //     const x = event.clientX - rect.left;
    //     const y = event.clientY - rect.top;
    //     // console.log('x y', x, y);

    //     const width = selectionLeft + x;
    //     const height = selectionTop + y;
    //     // console.log('width height', width, height);

    //     setSelectionWidth(width);
    //     setSelectionHeight(height);
    // }

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
    // #endregion handlers


    // #region render
    return (
        <StyledFilesView
            theme={theme}
            // onMouseDown={(event) => {
            //     if (!node.current) {
            //         return;
            //     }

            //     setSelecting(true);

            //     const rect = node.current.getBoundingClientRect();
            //     const top = event.clientY - rect.top;
            //     const left = event.clientX - rect.left;
            //     // console.log('top left', top, left);

            //     setSelectionTop(top);
            //     setSelectionLeft(left);
            // }}
            // onMouseUp={() => {
            //     setSelecting(false);
            // }}
            // onMouseMove={(event) => handleSelection(event)}
        >
            {/* {selecting && (
                <StyledFilesSelection
                    theme={theme}
                    style={{
                        top: selectionTop + 'px',
                        left: selectionLeft + 'px',
                        width: selectionWidth + 'px',
                        height: selectionHeight + 'px',
                    }}
                />
            )} */}

            <StyledFilesList
                ref={node}
                theme={theme}
                onClick={(event) => {
                    console.log('event.target', event.target);
                    console.log('node.current', node.current);
                    if (event.target === node.current) {
                        setSelectionIndexes([]);
                    }
                }}
                style={{
                    pointerEvents: selecting ? 'none' : 'initial',
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
