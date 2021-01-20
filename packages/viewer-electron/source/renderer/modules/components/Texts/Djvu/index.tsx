// #region imports
    // #region libraries
    import React, {
        useEffect,
    } from 'react';

    import {
        Theme,
    } from '@plurid/plurid-themes';
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
    // #endregion properties



    // #region effects
    useEffect(() => {
        window.onload = function() {
            // save as a global value
            const viewerInstance = new DjVu.Viewer();
            // render into the element
            viewerInstance.render(
                document.querySelector("#djvu_viewer"),
            );
            viewerInstance.loadDocumentByUrl(file);
        };
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
                id="djvu_viewer"
            />
        </StyledDjvu>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default Djvu;
// #endregion exports
