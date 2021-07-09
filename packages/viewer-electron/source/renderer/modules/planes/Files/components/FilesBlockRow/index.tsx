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
    import FileBlock from '../FileBlock';
    // #endregion external


    // #region internal
    import {
        StyledFilesBlockRow,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
export interface FilesBlockRowProperties {
    // #region required
        // #region values
        theme: Theme;
        files: Dirent[];
        viewDirectory: string;
        selectionIndexes: number[];
        // #endregion values

        // #region methods
        selectionClick: (event: React.MouseEvent, index: number) => void;
        actionClick: (file: Dirent) => void;
        setCursorOverIndex: React.Dispatch<React.SetStateAction<number>>;
        // #endregion methods
    // #endregion required
}

const FilesBlockRow: React.FC<FilesBlockRowProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region required
            // #region values
            theme,
            files,
            viewDirectory,
            selectionIndexes,
            // #endregion values

            // #region methods
            selectionClick,
            actionClick,
            setCursorOverIndex,
            // #endregion methods
        // #endregion required
    } = properties;
    // #endregion properties


    // #region render
    return (
        <StyledFilesBlockRow
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
        </StyledFilesBlockRow>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default FilesBlockRow;
// #endregion exports
