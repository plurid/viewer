// #region imports
    // #region libraries
    import React from 'react';

    import {
        Theme,
    } from '@plurid/plurid-themes';

    import {
        PluridIconArrowLeft,
        PluridIconArrowRight,
    } from '@plurid/plurid-icons-react';
    // #endregion libraries


    // #region external
    // #endregion external


    // #region internal
    import {
        StyledHistory,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
export interface HistoryProperties {
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

const History: React.FC<HistoryProperties> = (
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
        <StyledHistory
            theme={theme}
        >
            <PluridIconArrowLeft
                theme={theme}
                title="Previous"
            />

            <PluridIconArrowRight
                theme={theme}
                title="Next"
            />
        </StyledHistory>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default History;
// #endregion exports
