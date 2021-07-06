// #region imports
    // #region libraries
    import {
        Dirent,
    } from 'fs';

    import path from 'path';

    import React, {
        // useState,
    } from 'react';

    import {
        Theme,
    } from '@plurid/plurid-themes';

    import {
        PluridLink,
    } from '@plurid/plurid-react';
    // #endregion libraries


    // #region external
    import DirectoryIcon from '../DirectoryIcon';
    import FileIcon from '../FileIcon';
    // #endregion external


    // #region internal
    import {
        StyledFileItem,
        StyledFileItemIcon,
        StyledFileItemName,
    } from './styled';
    // #endregion internal
// #endregion imports



// #region module
export interface FileItemOwnProperties {
    theme: Theme;
    path: string;
    file: Dirent;
    index: number;
    selected: boolean;

    selectionClick: (
        event: React.MouseEvent,
        index: number,
    ) => void;
    actionClick: (
        file: Dirent,
    ) => void;
}


const FileItem: React.FC<FileItemOwnProperties> = (
    properties,
) => {
    // #region properties
    const {
        theme,
        path: filepath,
        file,
        index,
        selected,

        selectionClick,
        actionClick,
    } = properties;

    const isFile = file.isFile();
    const isDirectory = file.isDirectory();

    const extension = isFile
        ? path.extname(file.name)
        : '';

    const page = `${filepath}${file.name}`;
    // #endregion properties


    // #region render
    return (
        <StyledFileItem
            theme={theme}
            selected={selected}
            onClick={(event) => {
                switch (event.detail) {
                    case 1:
                        selectionClick(event, index);
                        break;
                    case 2:
                        actionClick(file);
                        break;
                }
            }}
        >
            <StyledFileItemIcon>
                {isDirectory
                    ? (
                        <DirectoryIcon
                            theme={theme}
                        />
                    ) : isFile
                        ? (
                            <FileIcon
                                theme={theme}
                                extension={extension}
                            />
                        )
                        : ''
                }
            </StyledFileItemIcon>

            <PluridLink
                route={'/' + page.slice(1,).replace(/\//g, '-')}
                devisible={true}
                // style={{
                //     display: 'block',
                //     width: '100%',
                // }}
            >
                <StyledFileItemName>
                    {file.name}
                </StyledFileItemName>
            </PluridLink>
        </StyledFileItem>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default FileItem;
// #endregion exports
