// #region imports
    // #region libraries
    import React from 'react';

    import {
        AnyAction,
        ThunkDispatch,
    } from '@reduxjs/toolkit';
    import { connect } from 'react-redux';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #endregion libraries


    // #region external
    import { AppState } from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';
    import selectors from '~renderer-services/state/selectors';
    import actions from '~renderer-services/state/actions';
    // #endregion external


    // #region internal
    import {
        StyledGeneral,
    } from './styled';

    import Data from './components/Data';
    import Themes from './components/Themes';
    import Space from './components/Space';
    import Toolbars from './components/Toolbars';
    import Shortcuts from './components/Shortcuts';
    // #endregion internal
// #endregion imports



// #region module
export interface GeneralOwnProperties {
}

export interface GeneralStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
    stateIdentonym: string;
}

export interface GeneralDispatchProperties {
}

export type GeneralProperties =
    & GeneralOwnProperties
    & GeneralStateProperties
    & GeneralDispatchProperties;


const General: React.FC<GeneralProperties> = (
    properties,
) => {
    // #region properties
    // const {
    //     // #region state
    //     // stateGeneralTheme,
    //     // stateInteractionTheme,
    //     // stateIdentonym,
    //     // #endregion state
    // } = properties;
    // #endregion properties


    // #region render
    return (
        <StyledGeneral>
            <Data />

            <Themes />

            <Space />

            <Toolbars />

            <Shortcuts />
        </StyledGeneral>
    );
    // #endregion render
}


const mapStateToProps = (
    state: AppState,
): GeneralStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
    stateIdentonym: selectors.owner.getIdentonym(state),
});


const mapDispatchToProps = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): GeneralDispatchProperties => ({
});


const ConnectedGeneral = connect(
    mapStateToProps,
    mapDispatchToProps,
    null,
    {
        context: StateContext,
    },
)(General);
// #endregion module



// #region exports
export default ConnectedGeneral;
// #endregion exports
