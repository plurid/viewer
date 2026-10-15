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
        StyledFilesColumn,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
export interface FilesColumnProperties {
    // #region required
        // #region values
        theme: Theme;
        // #endregion values

        // #region methods
        // #endregion methods
    // #endregion required
}

const FilesColumn: React.FC<FilesColumnProperties> = (
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
    } = properties;
    // #endregion properties


    // #region render
    return (
        <StyledFilesColumn
            theme={theme}
        >
            FilesColumn
        </StyledFilesColumn>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default FilesColumn;
// #endregion exports
