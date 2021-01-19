// #region imports
    // #region libraries
    import React from 'react';

    import EpubReader from 'epub';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #endregion libraries


    // #region external
    // #endregion external


    // #region internal
    import {
        StyledEpub,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
export interface EpubProperties {
    // #region required
        // #region values
        theme: Theme;
        file: string;
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

const Epub: React.FC<EpubProperties> = (
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
        <StyledEpub
            theme={theme}
        >
            Epub
        </StyledEpub>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default Epub;
// #endregion exports
