// #region imports
    // #region libraries
    import React from 'react';

    import {
        AnyAction,
        ThunkDispatch,
    } from '@reduxjs/toolkit';
    import { connect } from 'react-redux';


    import {
        Theme,
    } from '@plurid/plurid-themes';

    import {
        PluridIconDelete,
    } from '@plurid/plurid-icons-react';
    // #endregion libraries


    // #region external
    import {
        removePlane,
    } from '~renderer-services/logic/dispatches';

    import { AppState } from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';
    import selectors from '~renderer-services/state/selectors';
    // import actions from '~renderer-services/state/actions';
    // #endregion external


    // #region internal
    import {
        StyledFilesTopBar,
        StyledFilesTopBarCenter,
        StyledFilesTopBarRight,
    } from './styled';

    import DirectoryPath from '../DirectoryPath';

    import DirectAccess from './components/DirectAccess';
    import History from './components/History';
    import ViewModes from './components/ViewModes';
    import Actions from './components/Actions';
    import Search from './components/Search';
    // #endregion internal
// #endregion imports



// #region module
export interface FilesTopBarOwnProperties {
    planeID: string;

    viewDirectory: string;

    viewShowDirectAccess: boolean;
    setViewShowDirectAccess: (showDirectAccess: boolean) => void;

    setViewDirectory: (directory: string) => void;
    viewShowAs: string;
    setViewShowAs: (showAs: string) => void;
    pluridLinkNavigation: boolean;
    setPluridLinkNavigation: (pluridLinkNavigation: boolean) => void;

    searchValue: string;
    setSearchValue: (searchValue: string) => void;

    hasPreviousHistory: boolean;
    hasNextHistory: boolean;

    historyStepPrevious: () => void;
    historyStepNext: () => void;
}

export interface FilesTopBarStateProperties {
    state: AppState;
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
}

export interface FilesTopBarDispatchProperties {
    dispatch: ThunkDispatch<{}, {}, AnyAction>;
}

export type FilesTopBarProperties =
    & FilesTopBarOwnProperties
    & FilesTopBarStateProperties
    & FilesTopBarDispatchProperties;


const FilesTopBar: React.FC<FilesTopBarProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region own
        planeID,

        viewDirectory,

        viewShowDirectAccess,
        setViewShowDirectAccess,

        setViewDirectory,
        viewShowAs,
        setViewShowAs,
        pluridLinkNavigation,
        setPluridLinkNavigation,

        searchValue,
        setSearchValue,

        hasPreviousHistory,
        hasNextHistory,

        historyStepPrevious,
        historyStepNext,
        // #endregion own

        // #region state
        state,
        stateGeneralTheme,
        // stateInteractionTheme,
        // #endregion state

        // #region dispatch
        dispatch,
        // #endregion dispatch
    } = properties;
    // #endregion properties


    // #region render
    return (
        <StyledFilesTopBar
            theme={stateGeneralTheme}
        >
            <DirectAccess
                theme={stateGeneralTheme}
                viewShowDirectAccess={viewShowDirectAccess}
                setViewShowDirectAccess={setViewShowDirectAccess}
            />


            <StyledFilesTopBarCenter>
                <History
                    theme={stateGeneralTheme}

                    hasPreviousHistory={hasPreviousHistory}
                    hasNextHistory={hasNextHistory}

                    historyStepPrevious={historyStepPrevious}
                    historyStepNext={historyStepNext}
                />

                <DirectoryPath
                    theme={stateGeneralTheme}
                    directory={viewDirectory}
                    update={(directory) => {
                        setViewDirectory(directory);
                    }}
                />

                <ViewModes
                    theme={stateGeneralTheme}
                    viewShowAs={viewShowAs}
                    setViewShowAs={setViewShowAs}
                    pluridLinkNavigation={pluridLinkNavigation}
                    setPluridLinkNavigation={setPluridLinkNavigation}
                />

                <Actions
                    viewDirectory={viewDirectory}
                    theme={stateGeneralTheme}
                />
            </StyledFilesTopBarCenter>


            <StyledFilesTopBarRight>
                <Search
                    theme={stateGeneralTheme}
                    searchValue={searchValue}
                    setSearchValue={setSearchValue}
                />

                <PluridIconDelete
                    theme={stateGeneralTheme}
                    atClick={() => {
                        removePlane(
                            state,
                            dispatch,
                            planeID,
                        );
                    }}
                    title="Remove Plane"
                    titleAppearTime={2_500}
                />
            </StyledFilesTopBarRight>
        </StyledFilesTopBar>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): FilesTopBarStateProperties => ({
    state,
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): FilesTopBarDispatchProperties => ({
    dispatch,
});


const ConnectedFilesTopBar = connect(
    mapStateToProperties,
    mapDispatchToProperties,
    null,
    {
        context: StateContext,
    },
)(FilesTopBar);
// #endregion module



// #region exports
export default ConnectedFilesTopBar;
// #endregion exports
