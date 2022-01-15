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
        StyledStream,
    } from './styled';
    // #endregion internal
// #endregion imports



// #region module
export interface StreamOwnProperties {
}

export interface StreamStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
}

export interface StreamDispatchProperties {
}

export type StreamProperties =
    & StreamOwnProperties
    & StreamStateProperties
    & StreamDispatchProperties;


const Stream: React.FC<StreamProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region state
        stateGeneralTheme,
        // stateInteractionTheme,
        // #endregion state
    } = properties;
    // #endregion properties


    // #region render
    return (
        <StyledStream
            theme={stateGeneralTheme}
        >

        </StyledStream>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): StreamStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): StreamDispatchProperties => ({
});


const ConnectedStream = connect(
    mapStateToProperties,
    mapDispatchToProperties,
    null,
    {
        context: StateContext,
    },
)(Stream);
// #endregion module



// #region exports
export default ConnectedStream;
// #endregion exports
