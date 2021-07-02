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
    // import {
    //     SETTINGS_VIEW,
    //     SETTINGS_VIEW_TYPE,
    // } from '../../../../data/constants/views';

    import { AppState } from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';
    import selectors from '~renderer-services/state/selectors';
    import actions from '~renderer-services/state/actions';
    // #endregion external


    // #region internal
    import GeneralView from './containers/General';
    // import PrivateImagesView from './containers/PrivateImages';
    // import ObliterateImagesView from './containers/ObliterateImages';

    import {
        StyledBody,
    } from './styled';
    // #endregion internal
// #endregion imports



// #region module
export interface BodyOwnProperties {
}

export interface BodyStateProperties {
    stateGeneralTheme: Theme,
    stateInteractionTheme: Theme,
    // stateSettingsView: SETTINGS_VIEW_TYPE;
    stateIdentonym: string;
}

export interface BodyDispatchProperties {
}

export type BodyProperties =
    & BodyOwnProperties
    & BodyStateProperties
    & BodyDispatchProperties;


const Body: React.FC<BodyProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region state
        // stateGeneralTheme,
        // stateInteractionTheme,
        // stateSettingsView,
        stateIdentonym,
        // #endregion state
    } = properties;

    const stateSettingsView = '';
    // #endregion properties


    // #region render
    const renderView = () => {
        if (!stateIdentonym) {
            return (<GeneralView />);
        }

        // switch (stateSettingsView) {
        //     case SETTINGS_VIEW.GENERAL:
        //         return (<GeneralView />);
        //     case SETTINGS_VIEW.PRIVATE_IMAGES:
        //         return (<PrivateImagesView />);
        //     case SETTINGS_VIEW.OBLITERATE_IMAGES:
        //         return (<ObliterateImagesView />);
        // }

        return (<GeneralView />);
    }

    return (
        <StyledBody>
            {renderView()}
        </StyledBody>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): BodyStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
    // stateSettingsView: selectors.views.getSettingsView(state),
    stateIdentonym: selectors.owner.getIdentonym(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): BodyDispatchProperties => ({
});


const ConnectedBody = connect(
    mapStateToProperties,
    mapDispatchToProperties,
    null,
    {
        context: StateContext,
    },
)(Body);
// #endregion module



// #region exports
export default ConnectedBody;
// #endregion exports
