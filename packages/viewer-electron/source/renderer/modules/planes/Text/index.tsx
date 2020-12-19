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
        StyledText,
    } from './styled';
    // #endregion internal
// #endregion imports



// #region module
export interface TextOwnProperties {
}

export interface TextStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
}

export interface TextDispatchProperties {
}

export type TextProperties = TextOwnProperties
    & TextStateProperties
    & TextDispatchProperties;

const Text: React.FC<TextProperties> = (
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
        <StyledText>
            Text
        </StyledText>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): TextStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): TextDispatchProperties => ({
});


const ConnectedText = connect(
    mapStateToProperties,
    mapDispatchToProperties,
    null,
    {
        context: StateContext,
    },
)(Text);
// #endregion module



// #region exports
export default ConnectedText;
// #endregion exports
