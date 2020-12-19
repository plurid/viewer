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
        StyledVideo,
    } from './styled';
    // #endregion internal
// #endregion imports



// #region module
export interface VideoOwnProperties {
}

export interface VideoStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
}

export interface VideoDispatchProperties {
}

export type VideoProperties = VideoOwnProperties
    & VideoStateProperties
    & VideoDispatchProperties;

const Video: React.FC<VideoProperties> = (
    properties,
) => {
    // #region properties
    // const {
        // // #region state
        // stateGeneralTheme,
        // stateInteractionTheme,
        // // #endregion state
    // } = properties;
    // #endregion properties


    // #region render
    return (
        <StyledVideo>
            Video
        </StyledVideo>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): VideoStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
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
