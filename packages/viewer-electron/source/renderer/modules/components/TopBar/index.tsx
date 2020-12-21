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
    // #endregion libraries


    // #region external
    import { AppState } from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';
    import selectors from '~renderer-services/state/selectors';
    // import actions from '~renderer-services/state/actions';
    // #endregion external


    // #region internal
    import {
        StyledTopBar,
        StyledWindowButtons,
        StyledSpaces,
        StyledSpace,
    } from './styled';
    // #endregion internal
// #endregion imports



// #region module
export interface TopBarOwnProperties {
}

export interface TopBarStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
}

export interface TopBarDispatchProperties {
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
        // #endregion state
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
                // if (
                //     event.type === 'click'
                //     && event.button !== 0
                // ) {
                //     return;
                // }

                // setClicked(true);
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
                        <div
                            onClick={() => {
                                remote.BrowserWindow.getFocusedWindow()?.close();
                            }}
                        >
                            &times;
                        </div>

                        <div
                            onClick={() => {
                                remote.BrowserWindow.getFocusedWindow()?.minimize();
                            }}
                        >
                            &#95;
                        </div>

                        <div
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
                        </div>
                    </>
                )}
            </StyledWindowButtons>

            <StyledSpaces
                show={show}
            >
                <StyledSpace>
                    space 1
                </StyledSpace>

                <StyledSpace>
                    space 2
                </StyledSpace>
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
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): TopBarDispatchProperties => ({
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
