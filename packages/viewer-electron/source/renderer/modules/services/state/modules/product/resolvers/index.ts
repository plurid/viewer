// #region imports
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



const resolvers = {
    setProduct,
    unsetProduct,
    setLanguage,
    setField,
    addPlane,
    removePlane,
};
// #endregion module



// #region exports
export default resolvers;
// #endregion exports
