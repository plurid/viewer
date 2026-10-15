// #region imports
    // #region libraries
    import {
        uuid,
    } from '@plurid/plurid-functions';
    // #endregion libraries


    // #region external
    import * as Types from '../types';
    // #endregion external
// #endregion imports



// #region module
export const initialState: Types.State = {
    id: uuid.generate(),
    identonym: '',
    ownerQueried: false,
    onlineOwner: false,
};
// #endregion module



// #region exports
export default initialState;
// #endregion exports
