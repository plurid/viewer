// #region imports
    // #region libraries
    import React from 'react';

    import {
        AnyAction,
        ThunkDispatch,
    } from '@reduxjs/toolkit';
    import { connect } from 'react-redux';

    import {
        pluridRouterNavigate,
    } from '@plurid/plurid-react';

    import {
        pluridal,
    } from '@plurid/plurid-ui-components-react';
    // #endregion libraries


    // #region external
    import languageSelect from '~renderer-data/languages';

    import { AppState } from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';
    import selectors from '~renderer-services/state/selectors';
    import actions from '~renderer-services/state/actions';
    // #endregion external


    // #region internal
    import comuteButtons from './data';
    // #endregion internal
// #endregion imports



// #region module
const {
    toolbars: {
        ToolbarGeneral: ToolbarGeneralComponent,
    },
} = pluridal;


export interface ToolbarGeneralOwnProperties {
}

export interface ToolbarGeneralStateProperties {
    stateProductLanguage: string;
}

export interface ToolbarGeneralDispatchProperties {
    dispatchSetGeneralView: typeof actions.views.setGeneralView;
}

export type ToolbarGeneralProperties = ToolbarGeneralOwnProperties
    & ToolbarGeneralStateProperties
    & ToolbarGeneralDispatchProperties;

const ToolbarGeneral: React.FC<ToolbarGeneralProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region state
        stateProductLanguage,
        // #endregion state

        // #region dispatch
        dispatchSetGeneralView,
        // #endregion dispatch
    } = properties;

    const language = languageSelect(stateProductLanguage);

    const buttons = comuteButtons(language);
    // #endregion properties


    // #region handlers
    const handleNavigation = (
        view: string,
    ) => {
        dispatchSetGeneralView(view);
        pluridRouterNavigate(view);
    }
    // #endregion handlers


    // #region render
    return (
        <ToolbarGeneralComponent
            // #region required
                // #region values
                buttons={buttons}
                selectors={selectors}
                context={StateContext}
                // #endregion values

                // #region methods
                handleClick={handleNavigation}
                // #endregion methods
            // #endregion required

            // #region optional
                // #region values
                sittingButton={false}
                // #endregion values

                // #region methods
                // #endregion methods
            // #endregion optional
        />
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): ToolbarGeneralStateProperties => ({
    stateProductLanguage: selectors.product.getLanguage(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): ToolbarGeneralDispatchProperties => ({
    dispatchSetGeneralView: (
        payload,
    ) => dispatch(
        actions.views.setGeneralView(payload),
    ),
});


const ConnectedToolbarGeneral = connect(
    mapStateToProperties,
    mapDispatchToProperties,
    null,
    {
        context: StateContext,
    },
)(ToolbarGeneral);
// #endregion module



// #region exports
export default ConnectedToolbarGeneral;
// #endregion exports
