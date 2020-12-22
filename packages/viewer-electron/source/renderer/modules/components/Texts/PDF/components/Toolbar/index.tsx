// #region imports
    // #region libraries
    import React from 'react';

    import { AnyAction } from 'redux';
    import { connect } from 'react-redux';
    import { ThunkDispatch } from 'redux-thunk';

    import {
        pluridal,
    } from '@plurid/plurid-ui-components-react';
    // #endregion libraries


    // #region external
    import languageSelect from '~renderer-data/languages';

    import { AppState } from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';
    import selectors from '~renderer-services/state/selectors';
    // import actions from '~renderer-services/state/actions';
    // #endregion external


    // #region internal
    import comuteButtons from './data';
    // #endregion internal
// #endregion imports



// #region module
const {
    toolbars: {
        ToolbarSpecific: PluridToolbarSpecific,
    },
} = pluridal;


export interface ToolbarOwnProperties {
}

export interface ToolbarStateProperties {
    stateProductLanguage: string;
}

export interface ToolbarDispatchProperties {
}

export type ToolbarProperties = ToolbarOwnProperties
    & ToolbarStateProperties
    & ToolbarDispatchProperties;

const Toolbar: React.FC<ToolbarProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region state
        stateProductLanguage,
        // #endregion state

        // #region dispatch
        // #endregion dispatch
    } = properties;

    const language = languageSelect(stateProductLanguage);

    const buttons = comuteButtons(language);
    // #endregion properties


    // #region handlers
    const handleNavigation = (
        view: string,
    ) => {
    }
    // #endregion handlers


    // #region render
    return (
        <PluridToolbarSpecific
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
                position="right"
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
): ToolbarStateProperties => ({
    stateProductLanguage: selectors.product.getLanguage(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): ToolbarDispatchProperties => ({
});


const ConnectedToolbar = connect(
    mapStateToProperties,
    mapDispatchToProperties,
    null,
    {
        context: StateContext,
    },
)(Toolbar);
// #endregion module



// #region exports
export default ConnectedToolbar;
// #endregion exports
