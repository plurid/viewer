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
        PluridPlaneComponentProperty,
    } from '@plurid/plurid-react';
    // #endregion libraries


    // #region external
    import {
        Space,
    } from '~renderer-data/interfaces';

    import FileTopBar from '~renderer-components/FileTopBar';
    import FilePath from '~renderer-components/FileInformation/FilePath';
    import FileSize from '~renderer-components/FileInformation/FileSize';

    import {
        getPlaneByID,
    } from '~renderer-services/logic/data';

    import { AppState } from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';
    import selectors from '~renderer-services/state/selectors';
    // import actions from '~renderer-services/state/actions';
    // #endregion external


    // #region internal
    import {
        StyledUnknown,
    } from './styled';
    // #endregion internal
// #endregion imports



// #region module
export interface UnknownOwnProperties {
    plurid: PluridPlaneComponentProperty;
}

export interface UnknownStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
    stateSpaces: Space[];
    stateActiveSpaceID: string;
}

export interface UnknownDispatchProperties {
}

export type UnknownProperties =
    & UnknownOwnProperties
    & UnknownStateProperties
    & UnknownDispatchProperties;


const Unknown: React.FC<UnknownProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region required
            // #region values
            plurid,
            // #endregion values

            // #region methods
            // #endregion methods
        // #endregion required

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

    const planeData = activePlane.kind === 'unknown'
        ? activePlane
        : undefined;
    if (!planeData) {
        return (<></>);
    }

    const src = planeData.data.source;
    // #endregion properties


    // #region render
    const FileSettings = (
        <div>
        </div>
    );

    const FileInfo = (
        <div>
            <FilePath
                filepath={src}
            />

            <FileSize
                filepath={src}
            />
        </div>
    );

    return (
        <StyledUnknown
            theme={stateGeneralTheme}
        >
            <FileTopBar
                planeID={planeID}
                filepath={src}
                infoRender={FileInfo}
            />
        </StyledUnknown>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): UnknownStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
    stateSpaces: selectors.product.getSpaces(state),
    stateActiveSpaceID: selectors.product.getActiveSpace(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): UnknownDispatchProperties => ({
});


const ConnectedUnknown = connect(
    mapStateToProperties,
    mapDispatchToProperties,
    null,
    {
        context: StateContext,
    },
)(Unknown);
// #endregion module



// #region exports
export default ConnectedUnknown;
// #endregion exports
