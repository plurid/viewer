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
    // #endregion libraries


    // #region external
    import {
        Space,
    } from '~renderer-data/interfaces';

    import Epub from '~renderer-components/Texts/Epub';
    import PDF from '~renderer-components/Texts/PDF';

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
    plurid: PluridComponentProperty,
}

export interface TextStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
    stateSpaces: Space[];
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
        // #endregion state
    } = properties;

    const id = plurid.route.plane.parameters.id;

    const activeSpace = stateSpaces.length > 0 ? stateSpaces[0] : undefined;
    const activePlane = activeSpace
        ? activeSpace.planes.find(plane => plane.id === id)
        : undefined;

    const planeData = activePlane && activePlane.kind === 'text'
        ? activePlane
        : undefined;

    const file = planeData?.data.source || '';
    // #endregion properties


    // #region render
    return (
        <StyledText>
            {/* <PDF
                file={file}
                theme={stateGeneralTheme}
            /> */}
            <Epub
                file={file}
                theme={stateGeneralTheme}
            />
        </StyledText>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): TextStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
    stateSpaces: selectors.product.getSpaces(state),
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
