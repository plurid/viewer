// #region imports
    // #region libraries
    import React, {
        useState,
    } from 'react';

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
    import actions from '~renderer-services/state/actions';
    // #endregion external


    // #region internal
    import {
        StyledSpaceButton,
        StyledSpaceName,
    } from './styled';
    // #endregion internal
// #endregion imports



// #region module
export interface SpaceButtonOwnProperties {
    data: any;
}

export interface SpaceButtonStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
    stateActiveSpace: string;
}

export interface SpaceButtonDispatchProperties {
    dispatchProductSetField: typeof actions.product.setField;
    dispatchProductRemoveSpace: typeof actions.product.removeSpace;
}

export type SpaceButtonProperties =
    & SpaceButtonOwnProperties
    & SpaceButtonStateProperties
    & SpaceButtonDispatchProperties;


const SpaceButton: React.FC<SpaceButtonProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region own
        data,
        // #endregion own

        // #region state
        stateGeneralTheme,
        // stateInteractionTheme,
        stateActiveSpace,
        // #endregion state

        // #region dispatch
        dispatchProductSetField,
        dispatchProductRemoveSpace,
        // #endregion dispatch
    } = properties;

    const {
        id,
        name,
    } = data;
    // #endregion properties


    // #region state
    const [
        mouseOver,
        setMouseOver,
    ] = useState(false);
    // #endregion state


    // #region render
    return (
        <StyledSpaceButton
            theme={stateGeneralTheme}
            onMouseEnter={() => setMouseOver(true)}
            onMouseLeave={() => setMouseOver(false)}
        >
            <StyledSpaceName
                active={stateActiveSpace === id}
            >
                <div
                    onClick={() => {
                        if (stateActiveSpace !== id) {
                            dispatchProductSetField({
                                field: 'activeSpace',
                                data: id,
                            });
                        }
                    }}
                    style={{
                        marginBottom: '-0.9rem',
                        paddingBottom: '0.9rem',
                    }}
                >
                    {name}
                </div>

                <div
                    style={{
                        minWidth: '16px',
                        display: 'flex',
                        alignItems: 'center',
                    }}
                >
                    {mouseOver && (
                        <div
                            onClick={() => {
                                dispatchProductRemoveSpace(id);
                            }}
                            style={{
                                marginLeft: '5px',
                            }}
                        >
                            &times;
                        </div>
                    )}
                </div>
            </StyledSpaceName>
        </StyledSpaceButton>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): SpaceButtonStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
    stateActiveSpace: selectors.product.getActiveSpace(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): SpaceButtonDispatchProperties => ({
    dispatchProductSetField: (
        payload,
    ) => dispatch(
        actions.product.setField(payload),
    ),
    dispatchProductRemoveSpace: (
        payload,
    ) => dispatch(
        actions.product.removeSpace(payload),
    ),
});


const ConnectedSpaceButton = connect(
    mapStateToProperties,
    mapDispatchToProperties,
    null,
    {
        context: StateContext,
    },
)(SpaceButton);
// #endregion module



// #region exports
export default ConnectedSpaceButton;
// #endregion exports
