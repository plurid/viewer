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
        selectionTop,
        setSelectionTop,
    ] = useState(0);
    const [
        selectionLeft,
        setSelectionLeft,
    ] = useState(0);
    const [
        selectionWidth,
        setSelectionWidth,
    ] = useState(0);
    const [
        selectionHeight,
        setSelectionHeight,
    ] = useState(0);
    // #endregion state


    // #region handlers
    const handleSelection = (
        event: React.MouseEvent<HTMLDivElement>,
    ) => {
        if (!selecting) {
            return;
        }

        if (!node.current) {
            return;
        }

        const rect = node.current.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        // console.log('x y', x, y);

        const width = selectionLeft + x;
        const height = selectionTop + y;
        // console.log('width height', width, height);

        setSelectionWidth(width);
        setSelectionHeight(height);
    }
    // #endregion handlers


    // #region render
    return (
        <StyledFilesView
            theme={theme}
            ref={node}
            onMouseDown={(event) => {
                if (!node.current) {
                    return;
                }

                setSelecting(true);

                const rect = node.current.getBoundingClientRect();
                const top = event.clientY - rect.top;
                const left = event.clientX - rect.left;
                // console.log('top left', top, left);

                setSelectionTop(top);
                setSelectionLeft(left);
            }}
            onMouseUp={() => {
                setSelecting(false);
            }}
            onMouseMove={(event) => handleSelection(event)}
        >
            {selecting && (
                <StyledFilesSelection
                    theme={theme}
                    style={{
                        top: selectionTop + 'px',
                        left: selectionLeft + 'px',
                        width: selectionWidth + 'px',
                        height: selectionHeight + 'px',
                    }}
                />
            )}

            <StyledFilesList
                theme={theme}
                style={{
                    pointerEvents: selecting ? 'none' : 'initial',
                }}
            >
                {files.map(file => {
                    return (
                        <FileItem
                            key={Math.random() + ''}
                            path={viewDirectory}
                            file={file}
                            theme={theme}
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
