// #region imports
    // #region libraries
    import React from 'react';

    import {
        Theme,
    } from '@plurid/plurid-themes';

    import {
        PluridIconContents,
    } from '@plurid/plurid-icons-react';
    // #endregion libraries


    // #region external
    import {
        StyledTopBarButton,
    } from '~renderer-planes/Files/components/FilesTopBar/styled';
    // #endregion external


    // #region internal
    import {
        StyledDirectAccess,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
export interface DirectAccessProperties {
    // #region required
        // #region values
        theme: Theme;
        viewShowDirectAccess: boolean;
        setViewShowDirectAccess: (showDirectAccess: boolean) => void;
        // #endregion values

        // #region methods
        // #endregion methods
    // #endregion required
}

const DirectAccess: React.FC<DirectAccessProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region required
            // #region values
            theme,
            viewShowDirectAccess,
            setViewShowDirectAccess,
            // #endregion values

            // #region methods
            // #endregion methods
        // #endregion required
    } = properties;
    // #endregion properties


    // #region render
    return (
        <StyledDirectAccess
            theme={theme}
        >
            <StyledTopBarButton
                theme={theme}
                active={viewShowDirectAccess}
                onClick={() => setViewShowDirectAccess(!viewShowDirectAccess)}
            >
                <PluridIconContents
                    theme={theme}
                    title="Direct Access"
                />
            </StyledTopBarButton>
        </StyledDirectAccess>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default DirectAccess;
// #endregion exports
