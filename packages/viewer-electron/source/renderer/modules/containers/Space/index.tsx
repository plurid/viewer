// #region imports
    // #region libraries
    import path from 'path';

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
        remote,
    } from 'electron';

    import {
        Theme,
    } from '@plurid/plurid-themes';

    import {
        PluridApplication,
        PluridReactPlane,
        PluridPubSub,
        PLURID_PUBSUB_TOPIC,
    } from '@plurid/plurid-react';
    // #endregion libraries


    // #region external
    import {
        Space,
    } from '~renderer-data/interfaces';

    import ToolbarUtility from '~renderer-components/Toolbar/Utility';

    import ImagePlane from '~renderer-planes/Image';
    import VideoPlane from '~renderer-planes/Video';
    import SoundPlane from '~renderer-planes/Sound';
    import TextPlane from '~renderer-planes/Text';
    import UnknownPlane from '~renderer-planes/Unknown';
    import FilesPlane from '~renderer-planes/Files';

    import {
        PluridLinkButton,
    } from '~renderer-services/styled';

    import {
        addPlane,
    } from '~renderer-services/logic/dispatches';

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
        StyledSpaceEmpty,
    } from './styled';
    // #endregion internal
// #endregion imports



// #region module
const pluridPlanes: PluridReactPlane[] = [
    {
        route: '/images/:id',
        component: ImagePlane,
    },
    {
        route: '/videos/:id',
        component: VideoPlane,
    },
    {
        route: '/sounds/:id',
        component: SoundPlane,
    },
    {
        route: '/texts/:id',
        component: TextPlane,
    },
    {
        route: '/unknown/:id',
        component: UnknownPlane,
    },
    {
        route: '/files/:id',
        component: FilesPlane,
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
    state: AppState;
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
    stateSpaces: Space[];
    activeSpaceID: string;
    stateProductUI: any;
}

export interface SpaceDispatchProperties {
    dispatch: ThunkDispatch<{}, {}, AnyAction>;
    dispatchProductAddPlane: typeof actions.product.addPlane;
    dispatchAddNotification: typeof actions.notifications.addNotification;
}

export type SpaceProperties =
    & SpaceOwnProperties
    & SpaceStateProperties
    & SpaceDispatchProperties;


const Space: React.FC<SpaceProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region state
        state,
        stateGeneralTheme,
        // stateInteractionTheme,
        stateSpaces,
        activeSpaceID,
        stateProductUI,
        // #endregion state

        // #region dispatch
        dispatch,
        dispatchProductAddPlane,
        dispatchAddNotification,
        // #endregion dispatch
    } = properties;

    const activeSpace = stateSpaces.find(space => space.id === activeSpaceID);
    if (!activeSpace) {
        return (<></>);
    }

    const pluridData = computePluridData(activeSpace);
    // #endregion properties


    // #region references
    const currentXAngle = useRef(0);
    const currentYAngle = useRef(0);
    const currentXCoord = useRef(0);
    const currentYCoord = useRef(0);

    const lastOpenPath = useRef('');
    // #endregion references


    // #region state
    const [
        pluridView,
        setPluridView,
    ] = useState<string[]>(
        pluridData.view,
    );
    // #endregion state


    // #region handlers
    const addFiles = async (
        files: string[],
    ) => {
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
                spaceID: activeSpaceID,
                data: plane as any,
            });
            dispatchAddNotification(
                notification,
            );
        }
    }

    const openFile = async () => {
        const filesData = await remote.dialog.showOpenDialog({
            defaultPath: lastOpenPath.current,
            properties: [
                'openFile',
                'multiSelections',
            ],
        });

        const {
            canceled,
            filePaths,
        } = filesData;

        if (canceled) {
            return;
        }

        lastOpenPath.current = path.dirname(filePaths[0]);

        addFiles(filePaths);
    }
    // #endregion handlers


    // #region effects
    useEffect(() => {
        const {
            view,
        } = computePluridData(activeSpace);

        setPluridView(view);
    }, [
        activeSpace?.planes,
    ]);

    /**
     * IPC Renderer.
     */
    useEffect(() => {
        const addPlane = async (
            _: any,
            files: string[],
        ) => {
            const activeSpace = stateSpaces.find(space => space.id === activeSpaceID);
            if (!activeSpace) {
                return;
            }

            addFiles(files);
        }

        ipcRenderer.on('FILES_OPEN', addPlane);

        return () => {
            ipcRenderer.removeListener('FILES_OPEN', addPlane);
        }
    }, [
        activeSpaceID,
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
                    ? PLURID_PUBSUB_TOPIC.SPACE_ROTATE_X_WITH
                    : PLURID_PUBSUB_TOPIC.SPACE_ROTATE_Y_WITH;

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

                // pluridPubSub.publish(
                //     topic,
                //     {
                //         value: -1 * updateValue,
                //     },
                // );

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

                // if (newValue < 0) {
                //     pluridPubSub.publish(
                //         TOPICS.SPACE_SCALE_DOWN,
                //         {
                //             value: endValue,
                //         },
                //     );
                // } else {
                //     pluridPubSub.publish(
                //         TOPICS.SPACE_SCALE_UP,
                //         {
                //             value: endValue,
                //         },
                //     );
                // }
            }

            const handleTranslate = () => {
                const topic = mode === 'up/down'
                    ? PLURID_PUBSUB_TOPIC.SPACE_TRANSLATE_Y_WITH
                    : PLURID_PUBSUB_TOPIC.SPACE_TRANSLATE_X_WITH;

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

                // pluridPubSub.publish(
                //     topic,
                //     {
                //         value: -1 * updateValue,
                //     },
                // );
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
            {pluridView.length === 0 && (
                <StyledSpaceEmpty>
                    <p>
                        <PluridLinkButton
                            text="add"
                            atClick={() => addPlane(
                                state,
                                dispatch,
                            )}
                            theme={stateGeneralTheme}
                            inline={true}
                        />&nbsp;
                        a plane
                        <br />
                        or&nbsp;
                        <PluridLinkButton
                            text="open"
                            atClick={() => openFile()}
                            theme={stateGeneralTheme}
                            inline={true}
                        />
                        &nbsp;a file
                    </p>
                </StyledSpaceEmpty>
            )}

            {activeSpace && pluridView.length > 0 && (
                <PluridApplication
                    key={activeSpaceID}
                    planes={pluridPlanes}
                    view={pluridView}
                    pubsub={pluridPubSub}
                    configuration={{
                        elements: {
                            plane: {
                                controls: {
                                    show: false,
                                },
                            },
                        },
                    }}
                />
            )}

            <ToolbarUtility />
        </StyledSpace>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): SpaceStateProperties => ({
    state,
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
    stateSpaces: selectors.product.getSpaces(state),
    activeSpaceID: selectors.product.getActiveSpace(state),
    stateProductUI: selectors.product.getProductUI(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): SpaceDispatchProperties => ({
    dispatch,
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
