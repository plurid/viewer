// #region imports
    // #region libraries
    import {
        Dirent,
    } from 'fs';

    import path from 'path';

    import chokidar from 'chokidar';

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
        getFileType,
    } from '~renderer-services/logic/general';

    import {
        getDirectoryFiles,
        ignoreHiddenFiles,
    } from '~renderer-services/logic/files';

    import FileStrategy from '~renderer-services/logic/objects/FileStrategy';

    import { AppState } from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';
    import selectors from '~renderer-services/state/selectors';
    import actions from '~renderer-services/state/actions';
    // #endregion external


    // #region internal
    import {
        StyledFiles,
        StyledFilesZone,
        StyledFilesContainer,
    } from './styled';

    import FilesTopBar from './components/FilesTopBar';
    import DirectAccess from './components/DirectAccess';
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
    stateFilesFavorites: string[];
    stateFilesRecents: string[];
    stateFilesShowDirectAccessFavorites: boolean;
    stateFilesShowDirectAccessRecent: boolean;
}

export interface FilesDispatchProperties {
    dispatchProductAddPlane: typeof actions.product.addPlane;
    dispatchProductUpdatePlane: typeof actions.product.updatePlane;
    dispatchProductSetField: typeof actions.product.setField;
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
        stateFilesFavorites,
        stateFilesRecents,
        stateFilesShowDirectAccessFavorites,
        stateFilesShowDirectAccessRecent,
        // #endregion state

        // #region dispatch
        dispatchProductAddPlane,
        dispatchProductUpdatePlane,
        dispatchProductSetField,
        // #endregion dispatch
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
        directory: viewDirectory,
        history,
        placeInHistory,
        pluridLinkNavigation,
        searchValue,
        showAs: viewShowAs,
        showDirectAccess,
    } = planeData.data;
    // #endregion properties


    // #region references
    const isMounted = useRef(false);
    // #endregion references


    // #region state
    const [
        loading,
        setLoading,
    ] = useState(true);

    const [
        files,
        setFiles,
    ] = useState<Dirent[]>([]);

    const [
        viewError,
        setViewError,
    ] = useState('');


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
    const dispatchUpdate = (
        data: any
    ) => {
        dispatchProductUpdatePlane({
            spaceID: stateActiveSpaceID,
            planeID,
            data,
        });
    }

    const setViewDirectory = (
        directory: string,
    ) => {
        dispatchUpdate({
            directory,
        });
    }

    const setHistory = (
        history: string[],
    ) => {
        dispatchUpdate({
            history,
        });
    }

    const setPlaceInHistory = (
        placeInHistory: number,
    ) => {
        dispatchUpdate({
            placeInHistory,
        });
    }

    const setViewShowAs = (
        showAs: string,
    ) => {
        dispatchUpdate({
            showAs,
        });
    }

    const setSearchValue = (
        searchValue: string,
    ) => {
        dispatchUpdate({
            searchValue,
        });
    }

    const setShowDirectAccess = (
        showDirectAccess: boolean,
    ) => {
        dispatchUpdate({
            showDirectAccess,
        });
    }

    const setPluridLinkNavigation = (
        pluridLinkNavigation: boolean,
    ) => {
        dispatchUpdate({
            pluridLinkNavigation,
        });
    }

    const toggleDirectAccessFavorites = () => {
        dispatchProductSetField({
            field: 'filesShowDirectAccessFavorites',
            data: !stateFilesShowDirectAccessFavorites,
        });
    }

    const toggleDirectAccessRecent = () => {
        dispatchProductSetField({
            field: 'filesShowDirectAccessRecent',
            data: !stateFilesShowDirectAccessRecent,
        });
    }



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

    const actionClick = async (
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

        if (file.isFile()) {
            const filename = path.join(
                viewDirectory,
                file.name,
            );

            const {
                kind,
                extension,
            } = getFileType(filename);

            const strategy = new FileStrategy(
                kind,
                extension,
                filename,
            );
            const {
                plane,
            } = await strategy.apply();

            dispatchProductAddPlane({
                spaceID: stateActiveSpaceID,
                data: plane as any,
            });
        }
    }

    const actionCurrent = (
        selection: number[],
    ) => {
        if (selection.length === 0) {
            return;
        }

        if (selection.length === 1) {
            const file = files[selection[0]];
            actionClick(file);
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

    const upLevel = () => {
        const newViewDirectory = path.dirname(viewDirectory);
        setViewDirectory(newViewDirectory);
    }


    const readFiles = async () => {
        try {
            const files = await getDirectoryFiles(viewDirectory);

            if (!isMounted.current) {
                return;
            }

            setViewError('');
            setFiles(ignoreHiddenFiles(files));
            setLoading(false);
        } catch (error) {
            setFiles([]);
            setViewError('NOT_FOUND');
            setLoading(false);
        }
    }
    // #endregion handlers


    // #region effects
    useEffect(() => {
        isMounted.current = true;

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

    useEffect(() => {
        const watcher = chokidar.watch(
            viewDirectory,
            {
                depth: 0,
            },
        );

        watcher.on('all', (_event, _path, _details) => {
            readFiles();
        });

        return () => {
            watcher.close();
        }
    }, []);
    // #endregion effects


    // #region render
    return (
        <StyledFiles
            theme={stateGeneralTheme}
        >
            <FilesTopBar
                planeID={planeID}

                viewDirectory={viewDirectory}

                viewShowDirectAccess={showDirectAccess}
                setViewShowDirectAccess={setShowDirectAccess}

                setViewDirectory={setViewDirectory}
                viewShowAs={viewShowAs}
                setViewShowAs={setViewShowAs}
                pluridLinkNavigation={pluridLinkNavigation}
                setPluridLinkNavigation={setPluridLinkNavigation}

                searchValue={searchValue}
                setSearchValue={setSearchValue}

                hasPreviousHistory={hasPreviousHistory}
                hasNextHistory={hasNextHistory}

                historyStepPrevious={historyStepPrevious}
                historyStepNext={historyStepNext}
            />

            <StyledFilesZone
                splitView={showDirectAccess}
            >
                {showDirectAccess && (
                    <DirectAccess
                        theme={stateGeneralTheme}
                        favorites={stateFilesFavorites}
                        recents={stateFilesRecents}
                        viewDirectory={viewDirectory}
                        showFavorites={stateFilesShowDirectAccessFavorites}
                        showRecent={stateFilesShowDirectAccessRecent}

                        setViewDirectory={setViewDirectory}
                        toggleFavorites={toggleDirectAccessFavorites}
                        toggleRecent={toggleDirectAccessRecent}
                    />
                )}

                <StyledFilesContainer
                    theme={stateGeneralTheme}
                >
                    {!loading && (
                        <FilesView
                            theme={stateGeneralTheme}
                            files={files}
                            viewDirectory={viewDirectory}
                            viewShowAs={viewShowAs}
                            viewError={viewError}
                            pluridLinkNavigation={pluridLinkNavigation}

                            actionClick={actionClick}
                            actionCurrent={actionCurrent}
                            upLevel={upLevel}
                        />
                    )}
                </StyledFilesContainer>
            </StyledFilesZone>
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
    stateFilesFavorites: selectors.product.getFilesFavorites(state),
    stateFilesRecents: selectors.product.getFilesRecents(state),
    stateFilesShowDirectAccessFavorites: selectors.product.getFilesShowDirectAccessFavorites(state),
    stateFilesShowDirectAccessRecent: selectors.product.getFilesShowDirectAccessRecent(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): FilesDispatchProperties => ({
    dispatchProductAddPlane: (
        payload,
    ) => dispatch(
        actions.product.addPlane(payload),
    ),
    dispatchProductUpdatePlane: (
        payload,
    ) => dispatch(
        actions.product.updatePlane(payload),
    ),
    dispatchProductSetField: (
        payload,
    ) => dispatch(
        actions.product.setField(payload),
    ),
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
