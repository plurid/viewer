// #region module
    // #region external
    import {
        Space,
    } from '~renderer-data/interfaces';

    import {
        loadDatabase,
    } from '~renderer-services/database';
    // #endregion external
// #endregion module



// #region module
export const getActiveSpace = (
    spaces: Space[],
    activeSpaceID: string,
) => {
    if (spaces.length === 0) {
        return;
    }

    const activeSpace = spaces.find(space => space.id === activeSpaceID);
    return activeSpace;
}


export const getPlaneByID = (
    spaces: Space[],
    activeSpaceID: string,
    planeID: string,
) => {
    const activeSpace = getActiveSpace(
        spaces,
        activeSpaceID,
    );
    if (!activeSpace) {
        return;
    }

    const activePlane = activeSpace.planes.find(plane => plane.id === planeID);
    return activePlane;
}
// #endregion module
