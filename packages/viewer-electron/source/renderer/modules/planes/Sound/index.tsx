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
    import {
        Space,
    } from '~renderer-data/interfaces';

    import FileTopBar from '~renderer-components/FileTopBar';

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
        StyledSound,
    } from './styled';
    // #endregion internal
// #endregion imports



// #region module
export interface SoundOwnProperties {
    plurid: PluridPlaneComponentProperty;
}

export interface SoundStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
    stateSpaces: Space[];
    stateActiveSpaceID: string;
}

export interface SoundDispatchProperties {
}

export type SoundProperties =
    & SoundOwnProperties
    & SoundStateProperties
    & SoundDispatchProperties;


const Sound: React.FC<SoundProperties> = (
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

    const planeData = activePlane.kind === 'sound'
        ? activePlane
        : undefined;
    if (!planeData) {
        return (<></>);
    }

    const src = planeData.data.source;
    // #endregion properties


    // #region render
    return (
        <StyledSound
            theme={stateGeneralTheme}
        >
            <FileTopBar
                filepath={src}
                settingsRender={(
                    <div>
                        <div>
                            Convert to eaud
                        </div>
                    </div>
                )}
                infoRender={(
                    <div>
                        <div>
                            size
                        </div>
                    </div>
                )}
            />
        </StyledSound>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): SoundStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
    stateSpaces: selectors.product.getSpaces(state),
    stateActiveSpaceID: selectors.product.getActiveSpace(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): SoundDispatchProperties => ({
});


const ConnectedSound = connect(
    mapStateToProperties,
    mapDispatchToProperties,
    null,
    {
        context: StateContext,
    },
)(Sound);
// #endregion module



// #region exports
export default ConnectedSound;
// #endregion exports
