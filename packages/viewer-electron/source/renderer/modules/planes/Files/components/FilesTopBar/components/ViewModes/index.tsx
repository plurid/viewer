// #region imports
    // #region libraries
    import React from 'react';

    import {
        Theme,
    } from '@plurid/plurid-themes';

    import {
        PluridIconSpace,
    } from '@plurid/plurid-icons-react';
    // #endregion libraries


    // #region external
    // #endregion external


    // #region internal
    import {
        StyledViewModes,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
export interface ViewModesProperties {
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

const ViewModes: React.FC<ViewModesProperties> = (
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
        <StyledViewModes
            theme={theme}
        >
            <PluridIconSpace
                theme={theme}
                title="Show as Icons"
            />

            <PluridIconSpace
                theme={theme}
                title="Show as List"
            />

            <PluridIconSpace
                theme={theme}
                title="Show as Columns"
            />

            <PluridIconSpace
                theme={theme}
                title="Show as Gallery"
            />

            <PluridIconSpace
                theme={theme}
                title="Plurid Link Navigation"
            />
        </StyledViewModes>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default ViewModes;
// #endregion exports
