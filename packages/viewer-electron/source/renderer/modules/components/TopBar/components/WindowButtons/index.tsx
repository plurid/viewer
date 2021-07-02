// #region imports
    // #region libraries
    import React from 'react';

    import {
        remote,
    } from 'electron';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #endregion libraries


    // #region external
    // #endregion external


    // #region internal
    import {
        StyledWindowButtons,
        StyledWindowButton,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
export interface WindowButtonsProperties {
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

const WindowButtons: React.FC<WindowButtonsProperties> = (
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
        <StyledWindowButtons
            theme={theme}
        >
            {/* {show && (
                <>
                    <StyledWindowButton
                        onClick={() => {
                            remote.BrowserWindow.getFocusedWindow()?.close();
                        }}
                    >
                        &times;
                    </StyledWindowButton>

                    <StyledWindowButton
                        onClick={() => {
                            remote.BrowserWindow.getFocusedWindow()?.minimize();
                        }}
                    >
                        &#95;
                    </StyledWindowButton>

                    <StyledWindowButton
                        onClick={() => {
                            const window = remote.BrowserWindow.getFocusedWindow();

                            if (!window) {
                                return;
                            }

                            if (window.isMaximized()) {
                                window.unmaximize();
                            } else {
                                window.maximize();
                            }
                        }}
                    >
                        +
                    </StyledWindowButton>
                </>
            )} */}
        </StyledWindowButtons>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default WindowButtons;
// #endregion exports
