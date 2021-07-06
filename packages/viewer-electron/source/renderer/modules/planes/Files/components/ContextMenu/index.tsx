// #region imports
    // #region libraries
    import fsSync, {
        Dirent,
        promises as fs,
    } from 'fs';

    import path from 'path';

    import React from 'react';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #endregion libraries


    // #region external
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


    // #region handlers
    const resolveNewFolderPath = (
        newFolderPath: string,
    ) => {
        let index = 0;
        let searching = true;

        do {
            try {
                if (index === 0) {
                    const exists = fsSync.existsSync(newFolderPath);
                    if (!exists) {
                        searching = false;
                        break;
                    }

                    index += 1;
                    continue;
                }

                const exists = fsSync.existsSync(newFolderPath + ` ${index}`);
                if (!exists) {
                    searching = false;
                    break;
                }

                index += 1;
            } catch (error) {
                continue;
            }
        } while (searching);

        if (index === 0) {
            return newFolderPath;
        }

        return newFolderPath + ` ${index}`;
    }

    const newFolder = () => {
        try {
            const newFolderPath = path.join(
                viewDirectory,
                'New Folder',
            );

            const validPath = resolveNewFolderPath(newFolderPath);
            fs.mkdir(validPath);

            closeMenu();
        } catch (error) {
            return;
        }
    }
    // #endregion handlers


    // #region render
    return (
        <StyledContextMenu
            theme={theme}
            style={{
                left: left + 'px',
                top: top + 'px',
            }}
        >
            <div
                onClick={() => newFolder()}
            >
                New Folder
            </div>

            <div>
                Open in New Plane
            </div>
        </StyledContextMenu>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default ContextMenu;
// #endregion exports
