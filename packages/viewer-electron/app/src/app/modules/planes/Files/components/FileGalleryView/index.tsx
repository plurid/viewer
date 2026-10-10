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
    // #endregion external


    // #region internal
    import {
        StyledFileGalleryView,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
export interface FileGalleryViewProperties {
    // #region required
        // #region values
        theme: Theme;
        selected: Dirent | undefined;
        // #endregion values

        // #region methods
        // #endregion methods
    // #endregion required
}

const FileGalleryView: React.FC<FileGalleryViewProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region required
            // #region values
            theme,
            selected,
            // #endregion values

            // #region methods
            // #endregion methods
        // #endregion required
    } = properties;
    // #endregion properties


    // #region render
    return (
        <StyledFileGalleryView
            theme={theme}
        >
            {!selected && (
                <div>
                    select a file
                </div>
            )}

            {selected && (
                <div>
                    file
                </div>
            )}
        </StyledFileGalleryView>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default FileGalleryView;
// #endregion exports
