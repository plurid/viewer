// #region module
export const SET_OWNER = 'SET_OWNER';
export interface SetOwnerAction {
    type: typeof SET_OWNER;
    payload: any;
}


export const UNSET_OWNER = 'UNSET_OWNER';
export interface UnsetOwnerAction {
    type: typeof UNSET_OWNER;
}



export interface State {
    id: string;
    identonym: string;
    ownerQueried: boolean;
    onlineOwner: boolean;
}


export type Actions = SetOwnerAction
    | UnsetOwnerAction;
// #endregion module
