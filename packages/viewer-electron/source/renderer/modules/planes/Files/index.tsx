// #region imports
    // #region libraries
    import os from 'os';

    import {
        promises as fs,
    } from 'fs';

    import React, {
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
    import { AppState } from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';
    import selectors from '~renderer-services/state/selectors';
    // import actions from '~renderer-services/state/actions';
    // #endregion external


    // #region internal
    import {
        StyledFiles,
    } from './styled';
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
        stateInteractionTheme,
        // #endregion state
    } = properties;

    const id = plurid.plane.parameters.id;
    // #endregion properties


    // #region state
    const [
        files,
        setFiles,
    ] = useState<string[]>([]);
    // #endregion state


    // #region effects
    useEffect(() => {
        const readFiles = async () => {
            try {
                const files = await fs.readdir(os.homedir());
                setFiles(files);
            } catch (error) {
                return;
            }
        }

        readFiles()
    }, []);
    // #endregion effects


    // #region render
    return (
        <StyledFiles>
            {files.map(file => {
                return (
                    <div
                        key={Math.random() + ''}
                    >
                        {file}
                    </div>
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
