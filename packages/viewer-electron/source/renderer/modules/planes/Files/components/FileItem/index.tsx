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
}


const FileItem: React.FC<FileItemOwnProperties> = (
    properties,
) => {
    // #region properties
    const {
        theme,
        path: filepath,
        file,
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
        <PluridLink
            route={'/' + page.slice(1,).replace(/\//g, '-')}
            devisible={true}
            style={{
                display: 'block',
                width: '100%',
            }}
        >
            <StyledFileItem
                theme={theme}
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

                <StyledFileItemName>
                    {file.name}
                </StyledFileItemName>
            </StyledFileItem>
        </PluridLink>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default FileItem;
// #endregion exports
