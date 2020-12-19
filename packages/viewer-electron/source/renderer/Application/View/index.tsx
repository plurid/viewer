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
        pluridal,
    } from '@plurid/plurid-ui-components-react';
    // #endregion libraries


    // #region external
    import ToolbarGeneral from '~renderer-components/Toolbar/General';

    import Space from '~renderer-containers/Space';
    import Settings from '~renderer-containers/Settings';

    import {
        PluridGlobalStyles,
        GlobalStyles,
    } from '~renderer-services/styled';

    import { AppState } from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';
    import selectors from '~renderer-services/state/selectors';
    // import actions from '~renderer-services/state/actions';
    // #endregion external
// #endregion imports



// #region module
const {
    notifications: {
        Notifications: PluridNotifications,
    },
} = pluridal;


export interface ViewOwnProperties {
}

export interface ViewStateProperties {
    stateGeneralTheme: Theme;
    stateGeneralView: string;
}

export interface ViewDispatchProperties {
}

export type ViewProperties = ViewOwnProperties
    & ViewStateProperties
    & ViewDispatchProperties;


const View: React.FC<ViewProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region state
        stateGeneralTheme,
        stateGeneralView,
        // #endregion state
    } = properties;
    // #endregion properties


    // #region render
    const view = () => {
        switch (stateGeneralView) {
            case '/space':
                return (
                    <Space />
                );
            case '/settings':
                return (
                    <Settings />
                );
            default:
                return (
                    <></>
                );
        }
    }

    return (
        <>
            <PluridGlobalStyles
                    theme={stateGeneralTheme}
            />

            <GlobalStyles
                theme={stateGeneralTheme}
            />

            <ToolbarGeneral />

            <PluridNotifications
                selectors={selectors}
                context={StateContext}
            />

            {view()}
        </>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): ViewStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateGeneralView: selectors.views.getGeneralView(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): ViewDispatchProperties => ({
});


const ConnectedView = connect(
    mapStateToProperties,
    mapDispatchToProperties,
    null,
    {
        context: StateContext,
    },
)(View);
// #endregion module



// #region exports
export default ConnectedView;
// #endregion exports
