// #region imports
    // #region libraries
    import React, {
        useEffect,
        useState,
    } from 'react';

    import ReactEpubjs from 'react-epubjs';

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
}

const Epub: React.FC<EpubProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region required
            // #region values
            theme,
            file,
            // #endregion values

            // #region methods
            // #endregion methods
        // #endregion required
    } = properties;

    const [
        text,
        setText,
    ] = useState('');
    // #endregion properties


    // #region effects
    useEffect(() => {
    }, []);
    // #endregion effects


    // #region render
    return (
        <StyledEpub
            theme={theme}
        >
            <ReactEpubjs
                url={file}
            />
        </StyledEpub>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default Epub;
// #endregion exports
