// #region imports
    // #region libraries
    import {
        uuid,
    } from '@plurid/plurid-functions';
    // #endregion libraries


    // #region internal
    import initialState from '../initial';

    import * as Types from '../types';

    import {
        loadDatabase,
    } from '~renderer-services/database';
    // #endregion internal
// #endregion imports



// #region module
export const setProduct = (
    state: Types.State,
    action: Types.SetProductAction,
): Types.State => {
    return {
        ...state,
        ...action.payload,
    };
}


export const unsetProduct = (): Types.State => {
    return {
        ...initialState,
    };
}


export const setLanguage = (
    state: Types.State,
    action: Types.SetLanguageAction,
): Types.State => {
    return {
        ...state,
        language: action.payload,
    };
}


export const setField = (
    state: Types.State,
    action: Types.SetFieldAction,
): Types.State => {
    const {
        field,
        data,
    } = action.payload;

    const newState = {
        ...state,
    };

    newState[field] = data;

    return newState;
}


export const addPlane = (
    state: Types.State,
    action: Types.AddPlaneAction,
): Types.State => {
    const {
        spaceID,
        data,
    } = action.payload;

    const spaces = state.spaces.map(space => {
        if (space.id === spaceID) {
            return {
                ...space,
                planes: [
                    ...space.planes,
                    {
                        ...data,
                    },
                ],
            };
        }

        return {
            ...space,
        };
    });

    const newState = {
        ...state,
        spaces,
    };

    return newState;
}


export const updatePlane = (
    state: Types.State,
    action: Types.UpdatePlaneAction,
): Types.State => {
    const newState = {
        ...state,
    };

    const {
        spaceID,
        planeID,
        data,
    } = action.payload;

    const space = state.spaces.find(space => space.id === spaceID);
    if (!space) {
        return newState;
    }

    const plane = space.planes.find(plane => plane.id === planeID);
    if (!plane) {
        return newState;
    }

    for (const [key, value] of Object.entries(data)) {
        plane.data[key] = value;
    }

    const planes = space.planes.map(spacePlane => {
        if (spacePlane.id === planeID) {
            return plane;
        }

        return spacePlane;
    });

    space.planes = [
        ...planes,
    ];

    const spaces = state.spaces.map(stateSpace => {
        if (stateSpace.id === spaceID) {
            return space;
        }

        return stateSpace;
    });

    return {
        ...newState,
        spaces,
    };
}


export const removePlane = (
    state: Types.State,
    action: Types.RemovePlaneAction,
): Types.State => {
    const {
        spaceID,
        planeID,
    } = action.payload;

    const spaces = state.spaces.map(space => {
        if (spaceID === space.id) {
            const planes = space.planes.filter(plane => plane.id !== planeID);

            return {
                ...space,
                planes,
            };
        }

        return {
            ...space,
        };
    });

    const newState = {
        ...state,
        spaces,
    };

    return newState;
}


export const addSpace = (
    state: Types.State,
    action: Types.AddSpaceAction,
): Types.State => {
    const spaces = [
        ...state.spaces,
        {
            id: uuid.generate(),
            name: 'new space',
            order: state.spaces.length,
            planes: [],
        },
    ];

    const newState = {
        ...state,
        spaces,
    };

    return newState;
}


export const removeSpace = (
    state: Types.State,
    action: Types.RemoveSpaceAction,
): Types.State => {
    const spaces = state.spaces.filter(space => space.id !== action.payload);

    if (spaces.length === 0) {
        spaces.push(
            {
                id: uuid.generate(),
                name: 'new space',
                order: state.spaces.length,
                planes: [],
            },
        );
    }

    const newState = {
        ...state,
        spaces,
    };

    return newState;
}



const resolvers = {
    setProduct,
    unsetProduct,
    setLanguage,
    setField,
    addPlane,
    updatePlane,
    removePlane,
    addSpace,
    removeSpace,
};
// #endregion module



// #region exports
export default resolvers;
// #endregion exports
