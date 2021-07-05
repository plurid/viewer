// #region imports
    // #region libraries
    import React from 'react';

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
        StyledFileSystem,
    } from './styled';
    // #endregion internal
// #endregion imports



// #region module
export interface FileSystemOwnProperties {
    plurid: PluridPlaneComponentProperty;
}

export interface FileSystemStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
}

export interface FileSystemDispatchProperties {
}

export type FileSystemProperties =
    & FileSystemOwnProperties
    & FileSystemStateProperties
    & FileSystemDispatchProperties;


const FileSystem: React.FC<FileSystemProperties> = (
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


    // #region render
    return (
        <StyledFileSystem
            theme={stateGeneralTheme}
        >

        </StyledFileSystem>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): FileSystemStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): FileSystemDispatchProperties => ({
});


const ConnectedFileSystem = connect(
    mapStateToProperties,
    mapDispatchToProperties,
    null,
    {
        context: StateContext,
    },
)(FileSystem);
// #endregion module



// #region exports
export default ConnectedFileSystem;
// #endregion exports
