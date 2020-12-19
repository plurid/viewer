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
        StyledSettings,
    } from './styled';
    // #endregion internal
// #endregion imports



// #region module
export interface SettingsOwnProperties {
}

export interface SettingsStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
}

export interface SettingsDispatchProperties {
}

export type SettingsProperties = SettingsOwnProperties
    & SettingsStateProperties
    & SettingsDispatchProperties;

const Settings: React.FC<SettingsProperties> = (
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
        <StyledSettings>
            Settings
        </StyledSettings>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): SettingsStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): SettingsDispatchProperties => ({
});


const ConnectedSettings = connect(
    mapStateToProperties,
    mapDispatchToProperties,
    null,
    {
        context: StateContext,
    },
)(Settings);
// #endregion module



// #region exports
export default ConnectedSettings;
// #endregion exports
