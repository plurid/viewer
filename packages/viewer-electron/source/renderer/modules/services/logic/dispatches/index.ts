// #region imports
    // #region libraries
    import os from 'os';

    import { AnyAction } from 'redux';
    import { ThunkDispatch } from 'redux-thunk';

    import {
        uuid,
    } from '@plurid/plurid-functions';
    // #endregion libraries


    // #region external
    import { AppState } from '~renderer-services/state/store';
    import actions from '~renderer-services/state/actions';
    // #endregion external
// #endregion imports



// #region module
export const addPlane = (
    state: AppState,
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
) => {
    const dispatchProductAddPlane: typeof actions.product.addPlane = (
        payload,
    ) => dispatch(
        actions.product.addPlane(payload),
    );

    const defaultFileSystemPath = os.homedir();
    const planeDirectory = state.product.filesDefaultOpenDirectory || defaultFileSystemPath;


    dispatchProductAddPlane({
        spaceID: state.product.activeSpace,
        data: {
            id: uuid.generate(),
            kind: 'files',
            data: {
                directory: planeDirectory,
                showAs: state.product.filesDefaultShowAs,
                pluridLinkNavigation: state.product.filesDefaultPluridLinkNavigation,
                searchValue: '',
                history: [
                    planeDirectory,
                ],
                placeInHistory: 0,
                showDirectAccess: state.product.filesShowDirectAccess,
            },
        },
    });
}
// #endregion module
