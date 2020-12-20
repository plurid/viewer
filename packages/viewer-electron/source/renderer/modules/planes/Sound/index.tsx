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
        StyledSound,
    } from './styled';
    // #endregion internal
// #endregion imports



// #region module
export interface SoundOwnProperties {
}

export interface SoundStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
}

export interface SoundDispatchProperties {
}

export type SoundProperties = SoundOwnProperties
    & SoundStateProperties
    & SoundDispatchProperties;

const Sound: React.FC<SoundProperties> = (
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
        <StyledSound>
            Sound
        </StyledSound>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): SoundStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
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
