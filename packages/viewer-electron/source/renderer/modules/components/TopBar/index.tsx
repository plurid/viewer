// #region imports
    // #region libraries
    import React, {
        useRef,
        useState,
        useEffect,
    } from 'react';

    import {
        AnyAction,
        ThunkDispatch,
    } from '@reduxjs/toolkit';
    import { connect } from 'react-redux';

    import {
        Theme,
    } from '@plurid/plurid-themes';

    import {
        PluridIconAdd,
    } from '@plurid/plurid-icons-react';
    // #endregion libraries


    // #region external
    import {
        Space,
    } from '~renderer-data/interfaces';

    import { AppState } from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';
    import selectors from '~renderer-services/state/selectors';
    import actions from '~renderer-services/state/actions';
    // #endregion external


    // #region internal
    import {
        StyledTopBar,
        StyledSpaces,
        StyledAddButton,
        StyledDragZone,
    } from './styled';

    import SpaceButton from './components/SpaceButton';
    // #endregion internal
// #endregion imports



// #region module
export interface TopBarOwnProperties {
}

export interface TopBarStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
    stateSpaces: Space[];
    stateActiveSpace: string;
    stateGeneralView: string;
}

export interface TopBarDispatchProperties {
    dispatchProductAddSpace: typeof actions.product.addSpace;
}

export type TopBarProperties =
    & TopBarOwnProperties
    & TopBarStateProperties
    & TopBarDispatchProperties;


const TopBar: React.FC<TopBarProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region state
        stateGeneralTheme,
        // stateInteractionTheme,
        stateSpaces,
        stateActiveSpace,
        stateGeneralView,
        // #endregion state

        // #region dispatch
        dispatchProductAddSpace,
        // #endregion dispatch
    } = properties;
    // #endregion properties


    // #region references
    const hoverOutTimeout = useRef<NodeJS.Timeout | null>(null);
    const pressTimer = useRef<NodeJS.Timeout | null>(null);
    // #endregion references


    // #region state
    const [
        mouseOver,
        setMouseOver,
    ] = useState(false);

    const [
        show,
        setShow,
    ] = useState(false);

    const [
        clicked,
        setClicked,
    ] = useState(false);

    const [
        longpress,
        setLongpress,
    ] = useState(false);

    const [
        draggable,
        setDraggable,
    ] = useState(false);
    // #endregion state


    // #region effects
    useEffect(() => {
        if (mouseOver) {
            setShow(true);
            return;
        }

        if (!mouseOver) {
            hoverOutTimeout.current = setTimeout(
                () => {
                    setShow(false);
                },
                750,
            );
        }

        return () => {
            if (hoverOutTimeout.current) {
                clearTimeout(hoverOutTimeout.current);
            }
        }
    }, [
        mouseOver,
    ]);

    // useEffect(() => {
    //     setLongpress(false);

    //     if (!pressTimer.current) {
    //         pressTimer.current = setTimeout(function() {
    //             setLongpress(true);
    //         }, 1000);
    //     }
    // }, [

    // ]);

    // useEffect(() => {
    //     if (longpress) {
    //         setDraggable(true);
    //     } else {
    //         setDraggable(false);
    //     }
    // }, [
    //     longpress,
    // ]);
    // #endregion effects


    // #region render
    return (
        <StyledTopBar
            onMouseEnter={() => setMouseOver(true)}
            onMouseLeave={() => setMouseOver(false)}
            onMouseMove={() => !mouseOver ? setMouseOver(true) : undefined}
            onClick={(event) => {
                if (
                    event.type === 'click'
                    && event.button !== 0
                ) {
                    return;
                }

                setClicked(true);
            }}
            onMouseUp={() => {
                // if (pressTimer.current) {
                //     clearTimeout(pressTimer.current);
                //     setLongpress(false);
                // }
            }}

            theme={stateGeneralTheme}
            show={show}
            isDraggable={draggable}
        >
            <StyledSpaces
                show={show}
            >
                {stateGeneralView === '/space'
                && stateSpaces.map(space => {
                    const {
                        id,
                    } = space;

                    return (
                        <SpaceButton
                            key={id}
                            data={space}
                        />
                    );
                })}

                {show && (
                    <StyledAddButton
                        onClick={() => {
                            dispatchProductAddSpace();
                        }}
                    >
                        <PluridIconAdd
                            size={14}
                            style={{
                                cursor: 'default !important',
                            }}
                        />
                    </StyledAddButton>
                )}

                <StyledDragZone />
            </StyledSpaces>
        </StyledTopBar>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): TopBarStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
    stateSpaces: selectors.product.getSpaces(state),
    stateActiveSpace: selectors.product.getActiveSpace(state),
    stateGeneralView: selectors.views.getGeneralView(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): TopBarDispatchProperties => ({
    dispatchProductAddSpace: () => dispatch(
        actions.product.addSpace(),
    ),
});


const ConnectedTopBar = connect(
    mapStateToProperties,
    mapDispatchToProperties,
    null,
    {
        context: StateContext,
    },
)(TopBar);
// #endregion module



// #region exports
export default ConnectedTopBar;
// #endregion exports
