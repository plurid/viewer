// #region imports
    // #region external
    import {
        Space,
        Plane,
    } from '~renderer-data/interfaces';
    // #endregion external
// #endregion imports



// #region module
export const SET_PRODUCT = 'SET_PRODUCT';
export interface SetProductAction {
    type: typeof SET_PRODUCT;
    payload: any;
}


export const UNSET_PRODUCT = 'UNSET_PRODUCT';
export interface UnsetProductAction {
    type: typeof UNSET_PRODUCT;
}


export const SET_LANGUAGE = 'SET_LANGUAGE';
export interface SetLanguageAction {
    type: typeof SET_LANGUAGE;
    payload: string;
}


export const SET_FIELD = 'SET_FIELD';
export interface SetFieldPayload {
    field: string;
    data: any;
}
export interface SetFieldAction {
    type: typeof SET_FIELD;
    payload: SetFieldPayload;
}


export const ADD_PLANE = 'ADD_PLANE';
export interface AddPlanePayload {
    spaceID: string;
    data: Plane;
}
export interface AddPlaneAction {
    type: typeof ADD_PLANE;
    payload: AddPlanePayload;
}


export const REMOVE_PLANE = 'REMOVE_PLANE';
export interface RemovePlanePayload {
    spaceID: string;
    planeID: string;
}
export interface RemovePlaneAction {
    type: typeof REMOVE_PLANE;
    payload: RemovePlanePayload;
}


export const ADD_SPACE = 'ADD_SPACE';
export interface AddSpaceAction {
    type: typeof ADD_SPACE;
}


export const REMOVE_SPACE = 'REMOVE_SPACE';
export interface RemoveSpaceAction {
    type: typeof REMOVE_SPACE;
    payload: string;
}



export interface State {
    ui: {
        toolbars: any;
        touchbar: {
            transformType: number;
            mode: string;
        };
    };
    language: string;
    spaces: Space[];
    activeSpace: string;
    filesFavorites: string[];
    filesRecents: string[];
    filesShowDirectAccess: boolean;
}


export type Actions =
    | SetProductAction
    | UnsetProductAction
    | SetLanguageAction
    | SetFieldAction
    | AddPlaneAction
    | RemovePlaneAction
    | AddSpaceAction
    | RemoveSpaceAction;
// #endregion module
