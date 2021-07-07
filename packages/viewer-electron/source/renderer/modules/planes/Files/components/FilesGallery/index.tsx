// #region imports
    // #region libraries
    import React from 'react';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #endregion libraries


    // #region external
    // #endregion external


    // #region internal
    import {
        StyledFilesGallery,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
export interface FilesGalleryProperties {
    // #region required
        // #region values
        theme: Theme;
        // #endregion values

        // #region methods
        // #endregion methods
    // #endregion required

    // #region optional
        // #region values
        // #endregion values

        // #region methods
        // #endregion methods
    // #endregion optional
}

const FilesGallery: React.FC<FilesGalleryProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region required
            // #region values
            theme,
            // #endregion values

            // #region methods
            // #endregion methods
        // #endregion required

        // #region optional
            // #region values
            // #endregion values

            // #region methods
            // #endregion methods
        // #endregion optional
    } = properties;
    // #endregion properties


    // #region render
    return (
        <StyledFilesGallery
            theme={theme}
        >
            FilesGallery
        </StyledFilesGallery>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default FilesGallery;
// #endregion exports
