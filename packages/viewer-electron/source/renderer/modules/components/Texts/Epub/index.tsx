// #region imports
    // #region libraries
    import React, {
        useRef,
        useEffect,
        useState,
    } from 'react';

    import ePub, {
        Rendition,
        Location,
    } from 'epubjs';

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
const onRelocated = (location: any) => {
    // save current cfi to localStorage
    const cfi = location.start.cfi
    localStorage.setItem('cfi', cfi)
}

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
    // #endregion properties


    // #region references
    const epubElement = useRef<HTMLDivElement | null>(null);
    // #endregion references


    // #region state
    const [
        rendition,
        setRendition,
    ] = useState<Rendition | null>(null);
    // #endregion state


    // #region handlers
    const onReaderLoad = (
        ebook: any,
        rendition: Rendition,
    ) => {
        if (!rendition) {
            return;
        }

        setRendition(rendition);

        rendition.display();
        // cfi ? rendition.display(cfi) : rendition.display()

        // setupStyles(rendition)

        ebook.ready.then(async () => {
            const { package: { metadata = {} } = {} } = ebook
            // setInfo(metadata)

            await ebook.locations.generate(1600);

            // onLoad && onLoad(rendition)
            // onRelocated && rendition.on('relocated', handleRelocated(ebook))
        })
    }
    // #endregion handlers


    // #region effects
    useEffect(() => {
        if (!epubElement.current) {
            return;
        }

        const ebook = ePub(file);
        const rendition = ebook.renderTo(
            epubElement.current,
            {
                flow: 'paginated',
                width: '100%',
                height: '100%',
            },
        );

        onReaderLoad(
            ebook,
            rendition,
        );
    }, []);
    // #endregion effects


    // #region render
    return (
        <StyledEpub
            theme={theme}
        >
            <div
                ref={epubElement}
            />
        </StyledEpub>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default Epub;
// #endregion exports
