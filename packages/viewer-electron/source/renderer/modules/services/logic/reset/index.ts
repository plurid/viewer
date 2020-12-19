// #region imports
    // #region libraries
    import { AnyAction } from 'redux';
    import { ThunkDispatch } from 'redux-thunk';
    // #endregion libraries


    // #region external
    import {
        loadDatabase,
    } from '~renderer-services/database';

    import actions from '~renderer-services/state/actions';
    // #endregion external
// #endregion imports



// #region module
const reset = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
) => {
}
// #endregion module



// #region exports
export default reset;
// #endregion exports
