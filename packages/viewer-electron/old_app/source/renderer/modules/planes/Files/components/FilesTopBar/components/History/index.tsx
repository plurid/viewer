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
    import {
        StyledTopBarButton,
    } from '~renderer-planes/Files/components/FilesTopBar/styled';
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

        hasPreviousHistory: boolean;
        hasNextHistory: boolean;

        historyStepPrevious: () => void;
        historyStepNext: () => void;
        // #endregion values

        // #region methods
        // #endregion methods
    // #endregion required
}

const History: React.FC<HistoryProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region required
            // #region values
            theme,

            hasPreviousHistory,
            hasNextHistory,

            historyStepPrevious,
            historyStepNext,
            // #endregion values

            // #region methods
            // #endregion methods
        // #endregion required
    } = properties;
    // #endregion properties


    // #region render
    return (
        <StyledHistory
            theme={theme}
        >
            <StyledTopBarButton
                theme={theme}
                disabled={!hasPreviousHistory}
                onClick={() => {
                    historyStepPrevious();
                }}
            >
                <PluridIconArrowLeft
                    theme={theme}
                    title="Previous"
                />
            </StyledTopBarButton>

            <StyledTopBarButton
                theme={theme}
                disabled={!hasNextHistory}
                onClick={() => {
                    historyStepNext();
                }}
            >
                <PluridIconArrowRight
                    theme={theme}
                    title="Next"
                />
            </StyledTopBarButton>
        </StyledHistory>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default History;
// #endregion exports
