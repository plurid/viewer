// #region imports
    // #region libraries
    import React, {
        useRef,
        useState,
        useEffect,
    } from 'react';

    import { AnyAction } from 'redux';
    import { connect } from 'react-redux';
    import { ThunkDispatch } from 'redux-thunk';

    import {
        remote,
    } from 'electron';

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
        StyledWindowButtons,
        StyledWindowButton,
        StyledSpaces,
        StyledSpace,
        StyledSpaceName,
        StyledAddButton,
    } from './styled';
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
    dispatchProductSetField: typeof actions.product.setField;
    dispatchProductAddSpace: typeof actions.product.addSpace;
}

export type TopBarProperties = TopBarOwnProperties
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
        dispatchProductSetField,
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
            <StyledWindowButtons>
                {show && (
                    <>
                        <StyledWindowButton
                            onClick={() => {
                                remote.BrowserWindow.getFocusedWindow()?.close();
                            }}
                        >
                            &times;
                        </StyledWindowButton>

                        <StyledWindowButton
                            onClick={() => {
                                remote.BrowserWindow.getFocusedWindow()?.minimize();
                            }}
                        >
                            &#95;
                        </StyledWindowButton>

                        <StyledWindowButton
                            onClick={() => {
                                const window = remote.BrowserWindow.getFocusedWindow();

                                if (!window) {
                                    return;
                                }

                                if (window.isMaximized()) {
                                    window.unmaximize();
                                } else {
                                    window.maximize();
                                }
                            }}
                        >
                            +
                        </StyledWindowButton>
                    </>
                )}
            </StyledWindowButtons>

            <StyledSpaces
                show={show}
            >
                {stateGeneralView === '/space'
                && stateSpaces.map(space => {
                    const {
                        id,
                        name,
                    } = space;

                    return (
                        <StyledSpace
                            key={id}
                            onClick={() => {
                                if (stateActiveSpace !== id) {
                                    dispatchProductSetField({
                                        field: 'activeSpace',
                                        data: id,
                                    });
                                }
                            }}
                        >
                            <StyledSpaceName
                                active={stateActiveSpace === id}
                            >
                                <div>
                                    {name}
                                </div>

                                <div
                                    style={{
                                        marginLeft: '5px',
                                    }}
                                >
                                    &times;
                                </div>
                            </StyledSpaceName>
                        </StyledSpace>
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
                        />
                    </StyledAddButton>
                )}
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
    dispatchProductSetField: (
        payload,
    ) => dispatch(
        actions.product.setField(payload),
    ),
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
