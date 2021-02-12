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
        ipcRenderer,
    } from 'electron';

    import {
        Theme,
    } from '@plurid/plurid-themes';

    import {
        PluridApplication,
        PluridPlane,
        PluridPubSub,
        TOPICS,
    } from '@plurid/plurid-react';
    // #endregion libraries


    // #region external
    import {
        Space,
    } from '~renderer-data/interfaces';

    import ImagePlane from '~renderer-planes/Image';
    import VideoPlane from '~renderer-planes/Video';
    import SoundPlane from '~renderer-planes/Sound';
    import TextPlane from '~renderer-planes/Text';
    import FilesPlane from '~renderer-planes/Files';

    import {
        getFileType,
    } from '~renderer-services/logic/general';

    import FileStrategy from '~renderer-services/logic/objects/FileStrategy';

    import { AppState } from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';
    import selectors from '~renderer-services/state/selectors';
    import actions from '~renderer-services/state/actions';
    // #endregion external


    // #region internal
    import {
        StyledSpace,
    } from './styled';
    // #endregion internal
// #endregion imports



// #region module
const pluridPlanes: PluridPlane[] = [
    {
        route: '/images/:id',
        component: {
            kind: 'react',
            element: ImagePlane,
        },
    },
    {
        route: '/videos/:id',
        component: {
            kind: 'react',
            element: VideoPlane,
        },
    },
    {
        route: '/sounds/:id',
        component: {
            kind: 'react',
            element: SoundPlane,
        },
    },
    {
        route: '/texts/:id',
        component: {
            kind: 'react',
            element: TextPlane,
        },
    },
    {
        route: '/files/:id',
        component: {
            kind: 'react',
            element: FilesPlane,
        },
    },
];


const computePluridData = (
    space: Space | undefined,
) => {
    const view: string[] = [];

    if (!space) {
        return {
            view,
        };
    }

    space.planes.forEach(plane => {
        const {
            id,
            kind,
        } = plane;

        const types = {
            image: 'images',
            video: 'videos',
            sound: 'sounds',
            text: 'texts',
            files: 'files',
        };
        const routeType = types[kind];
        if (!routeType) {
            return;
        }

        const planeID = `/${routeType}/` + id;

        view.push(planeID);
    });

    return {
        view,
    };
}

const pluridPubSub = new PluridPubSub();


export interface SpaceOwnProperties {
}

export interface SpaceStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
    stateSpaces: Space[];
    activeSpaceID: string;
    stateProductUI: any;
}

export interface SpaceDispatchProperties {
    dispatchProductAddPlane: typeof actions.product.addPlane;
    dispatchAddNotification: typeof actions.notifications.addNotification;
}

export type SpaceProperties = SpaceOwnProperties
    & SpaceStateProperties
    & SpaceDispatchProperties;


const Space: React.FC<SpaceProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region state
        // stateGeneralTheme,
        // stateInteractionTheme,
        stateSpaces,
        activeSpaceID,
        stateProductUI,
        // #endregion state

        // #region dispatch
        dispatchProductAddPlane,
        dispatchAddNotification,
        // #endregion dispatch
    } = properties;

    const activeSpaceInitial = stateSpaces.find(space => space.id === activeSpaceID);

    const pluridData = computePluridData(activeSpaceInitial);
    // #endregion properties


    const currentXAngle = useRef(0);
    const currentYAngle = useRef(0);
    const currentXCoord = useRef(0);
    const currentYCoord = useRef(0);


    // #region state
    const [
        activeSpace,
        setActiveSpace,
    ] = useState(
        stateSpaces.find(space => space.id === activeSpaceID),
    );

    const [
        pluridView,
        setPluridView,
    ] = useState<string[]>(
        pluridData.view,
    );
    // #endregion state


    // #region effects
    useEffect(() => {
        const {
            view,
        } = computePluridData(activeSpace);

        setPluridView(view);
    }, [
        activeSpace,
        activeSpace?.planes.length,
    ]);

    useEffect(() => {
        const activeSpace = stateSpaces.find(space => space.id === activeSpaceID);
        setActiveSpace(activeSpace);
    }, [
        activeSpaceID,
    ]);


    /**
     * IPC Renderer.
     */
    useEffect(() => {
        ipcRenderer.on('FILES_OPEN', async (
            _,
            files: string[],
        ) => {
            if (!activeSpace) {
                return;
            }

            for (const file of files) {
                const {
                    kind,
                    extension,
                } = getFileType(file);

                const strategy = new FileStrategy(
                    kind,
                    extension,
                    file,
                );
                const {
                    plane,
                    notification,
                } = await strategy.apply();

                dispatchProductAddPlane({
                    spaceID: activeSpace.id,
                    data: plane as any,
                });
                dispatchAddNotification(
                    notification,
                );
            }
        });
    }, [
    ]);

    useEffect(() => {
        const transformSpace = (
            _: any,
            value: any,
        ) => {
            const {
                transformType,
                mode,
            } = stateProductUI.touchbar;

            const handleRotate = () => {
                // console.log('stateProductUI', stateProductUI);
                const topic = mode === 'up/down'
                    ? TOPICS.SPACE_ROTATE_X_WITH
                    : TOPICS.SPACE_ROTATE_Y_WITH;

                const currentAngle = mode === 'up/down'
                    ? currentYAngle.current
                    : currentXAngle.current;

                // 0 - 0
                // 25 - -90
                // 50 - 0
                // 75 - 90
                // 100 - 0

                let newValue = ( (value - 50) / 100 ) * 2 * 180;
                let updateValue = currentAngle - newValue;
                // console.log(currentAngle.current, newValue, updateValue);
                if (mode === 'up/down') {
                    currentXAngle.current = newValue;
                } else {
                    currentYAngle.current = newValue;
                }

                pluridPubSub.publish(
                    topic,
                    {
                        value: -1 * updateValue,
                    },
                );

                // pluridPubSub.publish(
                //     TOPICS.SPACE_ROTATE_Y_TO,
                //     {
                //         value: value * 360 / 100,
                //     },
                // );
            }

            const handleScale = () => {
                let newValue = ( (value - 50) / 100 ) * 2 * 3;

                const endValue = newValue < 0
                    ? 1.01 - (((newValue * -1) * 33.33) / 100)
                    : newValue + 1;

                if (newValue < 0) {
                    pluridPubSub.publish(
                        TOPICS.SPACE_SCALE_DOWN,
                        {
                            value: endValue,
                        },
                    );
                } else {
                    pluridPubSub.publish(
                        TOPICS.SPACE_SCALE_UP,
                        {
                            value: endValue,
                        },
                    );
                }
            }

            const handleTranslate = () => {
                const topic = mode === 'up/down'
                    ? TOPICS.SPACE_TRANSLATE_Y_WITH
                    : TOPICS.SPACE_TRANSLATE_X_WITH;

                const currentCoord = mode === 'up/down'
                    ? currentYCoord.current
                    : currentXCoord.current;

                let newValue = ( (value - 50) / 100 ) * 2 * 500;
                let updateValue = currentCoord - newValue;
                // console.log(currentCoord.current, newValue, updateValue);
                if (mode === 'up/down') {
                    currentXCoord.current = newValue;
                } else {
                    currentYCoord.current = newValue;
                }

                pluridPubSub.publish(
                    topic,
                    {
                        value: -1 * updateValue,
                    },
                );
            }

            switch (transformType) {
                case 0:
                    handleTranslate();
                    break;
                case 1:
                    handleRotate();
                    break;
                case 2:
                    handleScale();
                    break;
            }
        }

        ipcRenderer.on('TOUCHBAR_SLIDER', transformSpace);

        return () => {
            ipcRenderer.removeListener('TOUCHBAR_SLIDER', transformSpace);
        }
    }, [
        stateProductUI.touchbar.transformType,
        stateProductUI.touchbar.mode,
    ]);
    // #endregion effects


    // #region render
    return (
        <StyledSpace>
            {activeSpace && (
                <PluridApplication
                    planes={pluridPlanes}
                    view={pluridView}
                    pubsub={pluridPubSub}
                />
            )}
        </StyledSpace>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): SpaceStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
    stateSpaces: selectors.product.getSpaces(state),
    activeSpaceID: selectors.product.getActiveSpace(state),
    stateProductUI: selectors.product.getProductUI(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): SpaceDispatchProperties => ({
    dispatchProductAddPlane: (
        payload,
    ) => dispatch(
        actions.product.addPlane(payload),
    ),
    dispatchAddNotification: (
        payload,
    ) => dispatch(
        actions.notifications.addNotification(payload),
    ),
});


const ConnectedSpace = connect(
    mapStateToProperties,
    mapDispatchToProperties,
    null,
    {
        context: StateContext,
    },
)(Space);
// #endregion module



// #region exports
export default ConnectedSpace;
// #endregion exports
