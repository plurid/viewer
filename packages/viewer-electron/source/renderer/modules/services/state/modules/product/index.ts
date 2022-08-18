// #region imports
    // #region libraries
    import {
        createSlice,
        PayloadAction,
    } from '@reduxjs/toolkit';

    import {
        uuid,
    } from '@plurid/plurid-functions';
    // #endregion libraries


    // #region external
    import {
        FileStream,
        Plane,
    } from '~renderer-data/interfaces';

    import type {
        AppState,
    } from '~renderer-services/state/store';
    // #endregion external


    // #region internal
    import * as Types from './types';
    import _initialState from './initial';
    import _selectors from './selectors';
    // #endregion internal
// #endregion imports



// #region module
export type ProductState = Types.State;


const initialState: ProductState = {
    ..._initialState,
};


export interface SetFieldPayload {
    field: keyof ProductState;
    data: any;
}

export interface AddPlanePayload {
    spaceID: string;
    data: Plane;
}

export interface UpdatePlanePayload {
    spaceID: string;
    planeID: string;
    data: Partial<any>;
}

export interface RemovePlanePayload {
    spaceID: string;
    planeID: string;
}

export interface AddStreamPayload {
    id: string;
    filepath: string;
    url: string;
}


export const name = 'product' as const;


export const product = createSlice({
    name,
    initialState,
    reducers: {
        setProduct: (
            state,
            action: PayloadAction<ProductState>,
        ) => {
            return {
                ...state,
                ...action.payload,
            };
        },
        unsetProduct: (
            state,
        ) => {
            state = {
                ...initialState,
            };
        },
        setLanguage: (
            state,
            action: PayloadAction<string>,
        ) => {
            state.language = action.payload;
        },
        setField: (
            state,
            action: PayloadAction<SetFieldPayload>,
        ) => {
            const {
                field,
                data,
            } = action.payload;

            (state as any)[field] = data;
        },
        addPlane: (
            state,
            action: PayloadAction<AddPlanePayload>,
        ) => {
            const {
                spaceID,
                data,
            } = action.payload;

            state.spaces = state.spaces.map(space => {
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
        },
        updatePlane: (
            state,
            action: PayloadAction<UpdatePlanePayload>,
        ) => {
            const {
                spaceID,
                planeID,
                data,
            } = action.payload;

            const space = state.spaces.find(space => space.id === spaceID);
            if (!space) {
                return;
            }

            const plane = space.planes.find(plane => plane.id === planeID);
            if (!plane) {
                return;
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

            state.spaces = state.spaces.map(stateSpace => {
                if (stateSpace.id === spaceID) {
                    return space;
                }

                return stateSpace;
            });
        },
        removePlane: (
            state,
            action: PayloadAction<RemovePlanePayload>,
        ) => {
            const {
                spaceID,
                planeID,
            } = action.payload;

            state.spaces = state.spaces.map(space => {
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
        },
        addSpace: (
            state,
        ) => {
            const spaces = [
                ...state.spaces,
                {
                    id: uuid.generate(),
                    name: 'new space',
                    order: state.spaces.length,
                    planes: [],
                },
            ];

            state.spaces = spaces;
        },
        removeSpace: (
            state,
            action: PayloadAction<string>,
        ) => {
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

            state.spaces = spaces;
        },
        addStream: (
            state,
            action: PayloadAction<AddStreamPayload>,
        ) => {
            const {
                payload,
            } = action;

            const {
                id,
                filepath,
                url,
            } = payload;


            const fileStream: FileStream = {
                id,
                filepath,
                url,
                localport: 9090,
                local: true,
                global: false,
            };


            const newFilesStreams = {
                ...state.filesStreams,
            };
            newFilesStreams[id] = {
                ...fileStream,
            };
            state.filesStreams = newFilesStreams;
        },
    },
});
// #endregion module



// #region exports
export const actions = product.actions;


// export const getProduct = (state: AppState) => state.product;

export const selectors = {
    ..._selectors,
};


export const reducer = product.reducer;
// #endregion exports
