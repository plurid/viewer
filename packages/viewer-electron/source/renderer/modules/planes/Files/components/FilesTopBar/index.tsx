// #region imports
    // #region libraries
    import React from 'react';

    import { AnyAction } from 'redux';
    import { connect } from 'react-redux';
    import { ThunkDispatch } from 'redux-thunk';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #endregion libraries


    // #region external
    import { AppState } from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';
    import selectors from '~renderer-services/state/selectors';
    // import actions from '~renderer-services/state/actions';
    // #endregion external


    // #region internal
    import {
        StyledFilesTopBar,
        StyledFilesTopBarCenter,
    } from './styled';

    import DirectoryPath from '../DirectoryPath';

    import Favorites from './components/Favorites';
    import History from './components/History';
    import ViewModes from './components/ViewModes';
    import Actions from './components/Actions';
    import Search from './components/Search';
    // #endregion internal
// #endregion imports



// #region module
export interface FilesTopBarOwnProperties {
    viewDirectory: string;

    viewShowDirectAccess: boolean;
    setViewShowDirectAccess: React.Dispatch<React.SetStateAction<boolean>>;

    setViewDirectory: (diretory: string) => void;
    viewShowAs: string;
    setViewShowAs: React.Dispatch<React.SetStateAction<string>>;
    pluridLinkNavigation: boolean;
    setPluridLinkNavigation: React.Dispatch<React.SetStateAction<boolean>>;

    searchString: string;
    setSearchString: React.Dispatch<React.SetStateAction<string>>;

    hasPreviousHistory: boolean;
    hasNextHistory: boolean;

    historyStepPrevious: () => void;
    historyStepNext: () => void;
}

export interface FilesTopBarStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
}

export interface FilesTopBarDispatchProperties {
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
        viewDirectory,

        viewShowDirectAccess,
        setViewShowDirectAccess,

        setViewDirectory,
        viewShowAs,
        setViewShowAs,
        pluridLinkNavigation,
        setPluridLinkNavigation,

        searchString,
        setSearchString,

        hasPreviousHistory,
        hasNextHistory,

        historyStepPrevious,
        historyStepNext,
        // #endregion own

        // #region state
        stateGeneralTheme,
        // stateInteractionTheme,
        // #endregion state
    } = properties;
    // #endregion properties


    // #region render
    return (
        <StyledFilesTopBar
            theme={stateGeneralTheme}
        >
            <Favorites
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
                    theme={stateGeneralTheme}
                />
            </StyledFilesTopBarCenter>

            <Search
                theme={stateGeneralTheme}
                searchString={searchString}
                setSearchString={setSearchString}
            />
        </StyledFilesTopBar>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): FilesTopBarStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): FilesTopBarDispatchProperties => ({
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
