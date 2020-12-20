// #region imports
    // #region libraries
    import React, {
        useState,
        useEffect,
    } from 'react';

    import { AnyAction } from 'redux';
    import { connect } from 'react-redux';
    import { ThunkDispatch } from 'redux-thunk';

    import {
        Theme,
    } from '@plurid/plurid-themes';

    import {
        PluridApplication,
        PluridPlane,
    } from '@plurid/plurid-react';
    // #endregion libraries


    // #region external
    import {
        Space,
    } from '~renderer-data/interfaces';

    import ImagePlane from '~renderer-planes/Image';
    import VideoPlane from '~renderer-planes/Video';
    import TextPlane from '~renderer-planes/Text';
    import FilesPlane from '~renderer-planes/Files';

    import { AppState } from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';
    import selectors from '~renderer-services/state/selectors';
    // import actions from '~renderer-services/state/actions';
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


export interface SpaceOwnProperties {
}

export interface SpaceStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
    stateSpaces: Space[];
}

export interface SpaceDispatchProperties {
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
        // #endregion state
    } = properties;

    const activeSpace = stateSpaces.length > 0 ? stateSpaces[0] : undefined;

    const pluridData = computePluridData(activeSpace);
    // #endregion properties


    // #region state
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
        activeSpace?.planes,
    ]);
    // #endregion effects


    // #region render
    return (
        <StyledSpace>
            {activeSpace && (
                <PluridApplication
                    planes={pluridPlanes}
                    view={pluridView}
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
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): SpaceDispatchProperties => ({
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
