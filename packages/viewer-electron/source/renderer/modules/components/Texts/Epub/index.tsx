// #region imports
    // #region libraries
    import React, {
        useEffect,
        useState,
    } from 'react';

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
            file,
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

    const epubReader = new EpubReader(file);

    const [
        text,
        setText,
    ] = useState('');
    // #endregion properties


    // #region effects
    useEffect(() => {
        const chapters = epubReader.flow;
        console.log('chapters', chapters);

        // epubReader.getChapter(chapters[0].id, (error, text) => {
        //     console.log(text);
        //     setText(text);
        // });
    }, []);
    // #endregion effects


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
