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
            // #endregion methods
        // #endregion required
    } = properties;
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
                    <div>
                        Delete Selected
                    </div>
                </PluridFormitem>
            )}

            <PluridFormitem>
                <div>
                    Open in New Plane
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
