// #region imports
    // #region libraries
    import {
        uuid,
    } from '@plurid/plurid-functions';
    // #endregion libraries


    // #region external
    import {
        loadDatabase,
    } from '~renderer-services/database';

    import {
        FileStream,
    } from '~renderer-data/interfaces';

    import initialState from '../initial';
    import * as Types from '../types';
    // #endregion external
// #endregion imports



// #region module
const setProduct = (
    state: Types.State,
    action: Types.SetProductAction,
): Types.State => {
    return {
        ...state,
        ...action.payload,
    };
}


const unsetProduct = (): Types.State => {
    return {
        ...initialState,
    };
}


const setLanguage = (
    state: Types.State,
    action: Types.SetLanguageAction,
): Types.State => {
    return {
        ...state,
        language: action.payload,
    };
}


const setField = (
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

    (newState as any)[field] = data;

    return newState;
}


const addPlane = (
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


const updatePlane = (
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


const removePlane = (
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


const addSpace = (
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


const removeSpace = (
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


const addStream = (
    state: Types.State,
    action: Types.AddStreamAction,
): Types.State => {
    const {
        payload,
    } = action;

    const {
        filepath,
    } = payload;


    const id = uuid.multiple();

    const fileStream: FileStream = {
        id,
        filepath,
        url: filepath,
        localport: 9090,
        local: true,
        global: false,
    };


    const newState = {
        ...state,
    };

    const newFilesStreams = {
        ...newState.filesStreams,
    };
    newFilesStreams[id] = {
        ...fileStream,
    };
    newState.filesStreams = newFilesStreams;

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
    addStream,
};
// #endregion module



// #region exports
export default resolvers;
// #endregion exports
