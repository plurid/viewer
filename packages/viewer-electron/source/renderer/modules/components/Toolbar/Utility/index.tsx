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
    import {
        addPlane,
    } from '~renderer-services/logic/dispatches';

    import { AppState } from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';
    import selectors from '~renderer-services/state/selectors';
    // import actions from '~renderer-services/state/actions';
    // #endregion external


    // #region internal
    import buttons from './data';
    // #endregion internal
// #endregion imports



// #region module
const {
    toolbars: {
        ToolbarSpecific,
    },
} = pluridal;


export interface UtilityOwnProperties {
}

export interface UtilityStateProperties {
    state: AppState;
    stateSpaces: any;
    stateActiveSpaceID: string;
}

export interface UtilityDispatchProperties {
    dispatch: ThunkDispatch<{}, {}, AnyAction>;
}

export type UtilityProperties =
    & UtilityOwnProperties
    & UtilityStateProperties
    & UtilityDispatchProperties;


const Utility: React.FC<UtilityProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region state
        state,
        // #endregion state

        // #region dispatch
        dispatch,
        // #endregion dispatch
    } = properties;
    // #endregion properties


    // #region handlers
    const togglePlaneList = () => {

    }

    const handleClick = (
        type: string,
    ) => {
        switch (type) {
            case 'ADD_PLANE':
                addPlane(
                    state,
                    dispatch,
                );
                break;
            case 'PLANE_LIST':
                togglePlaneList();
                break
        }
    }
    // #endregion handlers


    // #region render
    return (
        <ToolbarSpecific
            buttons={buttons}
            handleClick={handleClick}
            selectors={selectors}
            context={StateContext}
        />
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): UtilityStateProperties => ({
    state,
    stateSpaces: selectors.product.getSpaces(state),
    stateActiveSpaceID: selectors.product.getActiveSpace(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): UtilityDispatchProperties => ({
    dispatch,
});


const ConnectedUtility = connect(
    mapStateToProperties,
    mapDispatchToProperties,
    null,
    {
        context: StateContext,
    },
)(Utility);
// #endregion module



// #region exports
export default ConnectedUtility;
// #endregion exports
