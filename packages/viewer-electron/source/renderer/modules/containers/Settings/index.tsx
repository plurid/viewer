// #region imports
    // #region libraries
    import React from 'react';

    import {
        AnyAction,
        ThunkDispatch,
    } from '@reduxjs/toolkit';
    import { connect } from 'react-redux';
    // #endregion libraries


    // #region external
    import { AppState } from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';
    import selectors from '~renderer-services/state/selectors';
    import actions from '~renderer-services/state/actions';
    // #endregion external


    // #region internal
    import {
        StyledSettingsView,
        StyledSettingsContainer,
        StyledSettings,
    } from './styled';

    import Header from './components/Header';
    import Body from './components/Body';
    import Footer from './components/Footer';
    // #endregion internal
// #endregion imports



// #region module
export interface SettingsOwnProperties {
}

export interface SettingsStateProperties {
}

export interface SettingsDispatchProperties {
}

export type SettingsProperties =
    & SettingsOwnProperties
    & SettingsStateProperties
    & SettingsDispatchProperties;


const Settings: React.FC<SettingsProperties> = (
    properties,
) => {
    // #region render
    return (
        <StyledSettingsView>
            <StyledSettingsContainer>
                <h1>
                    viewer settings
                </h1>

                <StyledSettings>
                    <Header />

                    <Body />

                    <Footer />
                </StyledSettings>
            </StyledSettingsContainer>
        </StyledSettingsView>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
) => ({
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
) => ({
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
