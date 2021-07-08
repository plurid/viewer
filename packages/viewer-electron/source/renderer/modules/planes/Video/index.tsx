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

    import EnhancedVideo from '@plurid/enhanced-video-react';
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
        StyledVideo,
    } from './styled';
    // #endregion internal
// #endregion imports



// #region module
export interface VideoOwnProperties {
    plurid: PluridPlaneComponentProperty;
}

export interface VideoStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
    stateSpaces: Space[];
    stateActiveSpaceID: string;
}

export interface VideoDispatchProperties {
}

export type VideoProperties =
    & VideoOwnProperties
    & VideoStateProperties
    & VideoDispatchProperties;


const Video: React.FC<VideoProperties> = (
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

    const planeData = activePlane.kind === 'video'
        ? activePlane
        : undefined;
    if (!planeData) {
        return (<></>);
    }

    const type = 'video/mp4';
    const src = planeData.data.source;
    // #endregion properties


    // #region render
    return (
        <StyledVideo
            theme={stateGeneralTheme}
        >
            <FileTopBar
                filepath={src}
                settingsRender={(
                    <div>
                        <div>
                            Convert to evid
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

            <EnhancedVideo
                type={type}
                src={src}
                controls={true}
                mask="legacy"
                theme={stateGeneralTheme.name as any}
            />
        </StyledVideo>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): VideoStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
    stateSpaces: selectors.product.getSpaces(state),
    stateActiveSpaceID: selectors.product.getActiveSpace(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): VideoDispatchProperties => ({
});


const ConnectedVideo = connect(
    mapStateToProperties,
    mapDispatchToProperties,
    null,
    {
        context: StateContext,
    },
)(Video);
// #endregion module



// #region exports
export default ConnectedVideo;
// #endregion exports
