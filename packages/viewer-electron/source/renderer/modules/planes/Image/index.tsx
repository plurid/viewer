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
        StyledImage,
    } from './styled';
    // #endregion internal
// #endregion imports



// #region module
export interface ImageOwnProperties {
}

export interface ImageStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
}

export interface ImageDispatchProperties {
}

export type ImageProperties = ImageOwnProperties
    & ImageStateProperties
    & ImageDispatchProperties;

const Image: React.FC<ImageProperties> = (
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
        <StyledImage>
            Image
        </StyledImage>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): ImageStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): ImageDispatchProperties => ({
});


const ConnectedImage = connect(
    mapStateToProperties,
    mapDispatchToProperties,
    null,
    {
        context: StateContext,
    },
)(Image);
// #endregion module



// #region exports
export default ConnectedImage;
// #endregion exports
