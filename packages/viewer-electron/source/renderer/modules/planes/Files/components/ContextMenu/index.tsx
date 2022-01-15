// #region imports
    // #region libraries
    import {
        Dirent,
    } from 'fs';

    import React from 'react';


    import {
        Theme,
    } from '@plurid/plurid-themes';

    import {
        strings,
    } from '@plurid/plurid-functions';
    // #endregion libraries


    // #region external
    import {
        PluridFormitem,
    } from '~renderer-services/styled';

    import {
        newFolder,
    } from '~renderer-services/logic/files';
    // #endregion external


    // #region internal
    import {
        StyledContextMenu,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
export interface ContextMenuProperties {
    // #region required
        // #region values
        theme: Theme;
        left: number;
        top: number;
        viewDirectory: string;
        selectionIndexes: number[];
        files: Dirent[];
        // #endregion values

        // #region methods
        closeMenu: () => void;
        deleteSelectedFiles: () => void;
        // #endregion methods
    // #endregion required
}

const ContextMenu: React.FC<ContextMenuProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region required
            // #region values
            theme,
            left,
            top,
            viewDirectory,
            selectionIndexes,
            files,
            // #endregion values

            // #region methods
            closeMenu,
            deleteSelectedFiles,
            // #endregion methods
        // #endregion required
    } = properties;

    const selectedFilesText = selectionIndexes.length === 0
        ? ''
        : selectionIndexes.length === 1
            ? `'${strings.truncate(files[selectionIndexes[0]].name, 25)}'`
            : `Selected (${selectionIndexes.length})`;
    // #endregion properties


    // #region render
    return (
        <StyledContextMenu
            theme={theme}
            style={{
                left: left + 'px',
                top: top + 'px',
            }}
        >
            <PluridFormitem>
                <div
                    onClick={() => {
                        newFolder(viewDirectory);
                        closeMenu();
                    }}
                >
                    New Folder
                </div>
            </PluridFormitem>

            {selectionIndexes.length > 0 && (
                <PluridFormitem>
                    <div
                        onClick={() => {
                            deleteSelectedFiles();
                            closeMenu();
                        }}
                    >
                        Delete {selectedFilesText}
                    </div>
                </PluridFormitem>
            )}

            <PluridFormitem>
                <div>
                    Open in New Plane
                </div>
            </PluridFormitem>

            <PluridFormitem>
                <div>
                    Stream File
                </div>
            </PluridFormitem>
        </StyledContextMenu>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default ContextMenu;
// #endregion exports
