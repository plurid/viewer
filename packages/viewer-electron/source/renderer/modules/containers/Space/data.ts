// #region imports
    // #region libraries
    import {
        PluridReactPlane,
        PluridPubSub,
    } from '@plurid/plurid-react';
    // #endregion libraries


    // #region external
    import {
        Space,
    } from '~renderer-data/interfaces';

    import {
        pluridPlaneKinds,
    } from '~renderer-data/constants/defaults';

    import ImagePlane from '~renderer-planes/Image';
    import VideoPlane from '~renderer-planes/Video';
    import SoundPlane from '~renderer-planes/Sound';
    import TextPlane from '~renderer-planes/Text';
    import UnknownPlane from '~renderer-planes/Unknown';
    import FilesPlane from '~renderer-planes/Files';
    import StreamPlane from '~renderer-planes/Stream';
    // #endregion external
// #endregion imports



// #region module
export const pluridPlanes: PluridReactPlane[] = [
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
    {
        route: '/stream/:id',
        component: StreamPlane,
    },
];


export const computePluridData = (
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

        const routeType = (pluridPlaneKinds as any)[kind];
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


export const pluridPubSub = new PluridPubSub();
// #endregion module
