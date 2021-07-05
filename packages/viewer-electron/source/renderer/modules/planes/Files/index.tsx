// #region imports
    // #region libraries
    import os from 'os';

    import {
        Dirent,
        promises as fs,
    } from 'fs';

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
    } from './styled';

    import FileItem from './components/FileItem';
    // #endregion internal
// #endregion imports



// #region module
export interface FilesOwnProperties {
    plurid: PluridPlaneComponentProperty;
}

export interface FilesStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
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
        // #endregion state
    } = properties;

    const id = plurid.plane.parameters.id;
    // #endregion properties


    // #region references
    const isMounted = useRef(false);
    // #endregion references


    // #region state
    const [
        files,
        setFiles,
    ] = useState<Dirent[]>([]);
    // #endregion state


    // #region effects
    useEffect(() => {
        isMounted.current = true;

        const readFiles = async () => {
            try {
                const files = await getDirectoryFiles(os.homedir());

                if (!isMounted.current) {
                    return;
                }

                setFiles(ignoreHiddenFiles(files));
            } catch (error) {
                return;
            }
        }

        readFiles();

        return () => {
            isMounted.current = false;
        }
    }, []);
    // #endregion effects


    // #region render
    return (
        <StyledFiles
            theme={stateGeneralTheme}
        >
            {files.map(file => {
                return (
                    <FileItem
                        key={Math.random() + ''}
                        path={os.homedir()}
                        file={file}
                        theme={stateGeneralTheme}
                    />
                );
            })}
        </StyledFiles>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): FilesStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
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
