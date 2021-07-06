// #region imports
    // #region libraries
    import {
        Dirent,
    } from 'fs';

    import path from 'path';

    import React, {
        useRef,
        useState,
        useEffect,
    } from 'react';

    import { AnyAction } from 'redux';
    import { connect } from 'react-redux';
    import { ThunkDispatch } from 'redux-thunk';

    import {
        Theme,
    } from '@plurid/plurid-themes';

    import {
        PluridPlaneComponentProperty,
    } from '@plurid/plurid-react';
    // #endregion libraries


    // #region external
    import {
        Space,
    } from '~renderer-data/interfaces';

    import {
        getPlaneByID,
    } from '~renderer-services/logic/data';

    import {
        getDirectoryFiles,
        ignoreHiddenFiles,
    } from '~renderer-services/logic/files';

    import { AppState } from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';
    import selectors from '~renderer-services/state/selectors';
    // import actions from '~renderer-services/state/actions';
    // #endregion external


    // #region internal
    import {
        StyledFiles,
        StyledFilesView,
        StyledFilesNotFound,
    } from './styled';

    import FilesTopBar from './components/FilesTopBar';
    import Favorites from './components/Favorites';
    import FilesView from './components/FilesView';
    // #endregion internal
// #endregion imports



// #region module
export interface FilesOwnProperties {
    plurid: PluridPlaneComponentProperty;
}

export interface FilesStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
    stateSpaces: Space[];
    stateActiveSpaceID: string;
}

export interface FilesDispatchProperties {
}

export type FilesProperties =
    & FilesOwnProperties
    & FilesStateProperties
    & FilesDispatchProperties;


const Files: React.FC<FilesProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region own
        plurid,
        // #endregion own

        // #region state
        stateGeneralTheme,
        // stateInteractionTheme,
        stateSpaces,
        stateActiveSpaceID,
        // #endregion state
    } = properties;

    const planeID = plurid.plane.parameters.id;

    const activePlane = getPlaneByID(
        stateSpaces,
        stateActiveSpaceID,
        planeID,
    );
    if (!activePlane) {
        return (<></>);
    }

    const planeData = activePlane.kind === 'files'
        ? activePlane
        : undefined;
    if (!planeData) {
        return (<></>);
    }

    const {
        directory,
    } = planeData.data;
    // #endregion properties


    // #region references
    const isMounted = useRef(false);
    // #endregion references


    // #region state
    const [
        files,
        setFiles,
    ] = useState<Dirent[]>([]);

    const [
        viewDirectory,
        setViewDirectory,
    ] = useState(directory);

    const [
        viewError,
        setViewError,
    ] = useState('');


    const [
        viewShowFavorites,
        setViewShowFavorites,
    ] = useState(true);

    const [
        favorites,
        setFavorites,
    ] = useState([
        '/Applications',
    ]);


    const [
        viewShowAs,
        setViewShowAs,
    ] = useState('LIST');

    const [
        pluridLinkNavigation,
        setPluridLinkNavigation,
    ] = useState(true);

    const [
        searchString,
        setSearchString,
    ] = useState('');


    const [
        history,
        setHistory,
    ] = useState<string[]>([
        directory,
    ]);

    const [
        placeInHistory,
        setPlaceInHistory,
    ] = useState(0);

    const [
        hasPreviousHistory,
        setHasPreviousHistory,
    ] = useState(false);

    const [
        hasNextHistory,
        setHasNextHistory,
    ] = useState(false);
    // #endregion state


    // #region handlers
    const historyStepPrevious = () => {
        const previousIndex = placeInHistory - 1;
        const previousHistory = history[previousIndex];
        if (previousHistory) {
            setViewDirectory(previousHistory);
            setPlaceInHistory(previousIndex);
        }
    }

    const historyStepNext = () => {
        const nextIndex = placeInHistory + 1;
        const nextHistory = history[nextIndex];
        if (nextHistory) {
            setViewDirectory(nextHistory);
            setPlaceInHistory(nextIndex);
        }
    }

    const actionClick = (
        file: Dirent,
    ) => {
        if (file.isDirectory()) {
            const newViewDirectory = path.join(
                viewDirectory,
                file.name,
            );
            setViewDirectory(newViewDirectory);
            setPlaceInHistory(history.length);
            return;
        }
    }

    const actionCurrent = (
        selection: number[],
    ) => {
        if (selection.length === 0) {
            return;
        }

        const firstDirectoryIndex = selection.find(selectionIndex => {
            const file = files[selectionIndex];
            if (file.isDirectory()) {
                return true;
            }

            return false;
        });

        if (firstDirectoryIndex) {
            const firstDirectory = files[firstDirectoryIndex];
            actionClick(firstDirectory);
            return;
        }
    }
    // #endregion handlers


    // #region effects
    useEffect(() => {
        isMounted.current = true;

        const readFiles = async () => {
            try {
                const files = await getDirectoryFiles(viewDirectory);

                if (!isMounted.current) {
                    return;
                }

                setViewError('');
                setFiles(ignoreHiddenFiles(files));
            } catch (error) {
                setFiles([]);
                setViewError('NOT_FOUND');
            }
        }

        readFiles();

        return () => {
            isMounted.current = false;
        }
    }, [
        viewDirectory,
    ]);

    useEffect(() => {
        if (placeInHistory > 0) {
            setHasPreviousHistory(true);
        } else {
            setHasPreviousHistory(false);
        }

        if (placeInHistory < history.length - 1) {
            setHasNextHistory(true);
        } else {
            setHasNextHistory(false);
        }
    }, [
        placeInHistory,
        history.length,
    ]);

    useEffect(() => {
        if (history[history.length - 1] !== viewDirectory) {
            setHistory([
                ...history,
                viewDirectory,
            ]);
        }
    }, [
        viewDirectory,
    ]);
    // #endregion effects


    // #region render
    return (
        <StyledFiles
            theme={stateGeneralTheme}
        >
            <FilesTopBar
                viewDirectory={viewDirectory}

                viewShowFavorites={viewShowFavorites}
                setViewShowFavorites={setViewShowFavorites}

                setViewDirectory={setViewDirectory}
                viewShowAs={viewShowAs}
                setViewShowAs={setViewShowAs}
                pluridLinkNavigation={pluridLinkNavigation}
                setPluridLinkNavigation={setPluridLinkNavigation}

                searchString={searchString}
                setSearchString={setSearchString}

                hasPreviousHistory={hasPreviousHistory}
                hasNextHistory={hasNextHistory}

                historyStepPrevious={historyStepPrevious}
                historyStepNext={historyStepNext}
            />

            <StyledFilesView
                splitView={viewShowFavorites}
            >
                {viewShowFavorites && (
                    <Favorites
                        theme={stateGeneralTheme}
                        favorites={favorites}
                    />
                )}

                {viewError === 'NOT_FOUND' && (
                    <StyledFilesNotFound>
                        path not found
                    </StyledFilesNotFound>
                )}

                {files.length === 0 && viewError === '' &&  (
                    <StyledFilesNotFound>
                        no files
                    </StyledFilesNotFound>
                )}

                {files.length > 0 && (
                    <FilesView
                        theme={stateGeneralTheme}
                        files={files}
                        viewDirectory={viewDirectory}

                        actionClick={actionClick}
                        actionCurrent={actionCurrent}
                    />
                )}
            </StyledFilesView>
        </StyledFiles>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): FilesStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
    stateSpaces: selectors.product.getSpaces(state),
    stateActiveSpaceID: selectors.product.getActiveSpace(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): FilesDispatchProperties => ({
});


const ConnectedFiles = connect(
    mapStateToProperties,
    mapDispatchToProperties,
    null,
    {
        context: StateContext,
    },
)(Files);
// #endregion module



// #region exports
export default ConnectedFiles;
// #endregion exports
