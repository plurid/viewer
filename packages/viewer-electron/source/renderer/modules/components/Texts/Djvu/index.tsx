// #region imports
    // #region libraries
    import React, {
        useRef,
        useEffect,
    } from 'react';

    import {
        Theme,
    } from '@plurid/plurid-themes';

    import {
        uuid,
    } from '@plurid/plurid-functions';
    // #endregion libraries


    // #region external
    // #endregion external


    // #region internal
    import {
        StyledDjvu,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
export interface DjvuProperties {
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

const Djvu: React.FC<DjvuProperties> = (
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

    const viewerID = useRef<string>('djvu-viewer-' + uuid.generate());
    // #endregion properties


    // #region effects
    useEffect(() => {
        const viewerInstance = new DjVu.Viewer();

        viewerInstance.render(
            document.querySelector('#' + viewerID.current),
        );

        viewerInstance.loadDocumentByUrl(file);
    }, []);
    // #endregion effects


    // #region render
    return (
        <StyledDjvu
            theme={theme}
        >
            <div
                style={{
                    height: '900px',
                }}
                id={viewerID.current}
            />
        </StyledDjvu>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default Djvu;
// #endregion exports
