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
        PluridComponentProperty,
    } from '@plurid/plurid-react';

    import EnhancedImage from '@plurid/enhanced-image-react';
    // #endregion libraries


    // #region external
    import {
        Space,
    } from '~renderer-data/interfaces';

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
    plurid: PluridComponentProperty,
}

export interface ImageStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
    stateSpaces: Space[];
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
    const {
        // #region required
            // #region values
            plurid,
            // #endregion values

            // #region methods
            // #endregion methods
        // #endregion required

        // #region state
        // stateGeneralTheme,
        // stateInteractionTheme,
        stateSpaces,
        // #endregion state
    } = properties;

    // get from state based on the id
    const id = plurid.route.plane.parameters.id;

    const activeSpace = stateSpaces.length > 0 ? stateSpaces[0] : undefined;
    const activePlane = activeSpace
        ? activeSpace.planes.find(plane => plane.id === id)
        : undefined;

    const planeData = activePlane && activePlane.kind === 'image'
        ? activePlane
        : undefined;

    const src = planeData?.data.source || '';
    // #endregion properties


    // #region render
    return (
        <StyledImage>
            <div
                style={
                    {
                        width: 900,
                        margin: '150px auto',
                    }
                }
            >
                <EnhancedImage
                    src={src}
                />
            </div>
        </StyledImage>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): ImageStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
    stateSpaces: selectors.product.getSpaces(state),
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
