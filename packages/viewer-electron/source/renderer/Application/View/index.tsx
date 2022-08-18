// #region imports
    // #region libraries
    import React, {
        useEffect,
    } from 'react';

    import {
        AnyAction,
        ThunkDispatch,
    } from '@reduxjs/toolkit';
    import { connect } from 'react-redux';

    import {
        ipcRenderer,
    } from 'electron';

    import {
        Theme,
    } from '@plurid/plurid-themes';

    import {
        pluridal,
    } from '@plurid/plurid-ui-components-react';
    // #endregion libraries


    // #region external
    import TopBar from '~renderer-components/TopBar';
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
    import actions from '~renderer-services/state/actions';
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
    stateProductUI: any;
}

export interface ViewDispatchProperties {
    dispatchProductSetField: typeof actions.product.setField;
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
        stateProductUI,
        // #endregion state

        // #region dispatch
        dispatchProductSetField,
        // #endregion dispatch
    } = properties;
    // #endregion properties


    // #region effects
    useEffect(() => {
        const touchbarTransform = (
            _: any,
            value: any,
        ) => {
            dispatchProductSetField({
                field: 'ui',
                data: {
                    ...stateProductUI,
                    touchbar: {
                        ...stateProductUI.touchbar,
                        transformType: value.active ? value.type : -1,
                    },
                },
            });
        }

        const touchbarMode = (
            _: any,
            value: any,
        ) => {
            dispatchProductSetField({
                field: 'ui',
                data: {
                    ...stateProductUI,
                    touchbar: {
                        ...stateProductUI.touchbar,
                        mode: value,
                    },
                },
            });
        }

        ipcRenderer.on('TOUCHBAR_TRANSFORM', touchbarTransform);
        ipcRenderer.on('TOUCHBAR_MODE', touchbarMode);

        return () => {
            ipcRenderer.removeListener('TOUCHBAR_TRANSFORM', touchbarTransform);
            ipcRenderer.removeListener('TOUCHBAR_MODE', touchbarMode);
        }
    }, [
        stateProductUI,
    ]);
    // #endregion effects


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

            <TopBar />

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
    stateProductUI: selectors.product.getProductUI(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): ViewDispatchProperties => ({
    dispatchProductSetField: (
        payload,
    ) => dispatch(
        actions.product.setField(payload),
    ),
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
