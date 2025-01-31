// #region imports
    // #region libraries
    import os from 'os';

    import {
        AnyAction,
        ThunkDispatch,
    } from '@reduxjs/toolkit';

    import {
        uuid,
    } from '@plurid/plurid-functions';

    import {
        DispatchAction,
    } from '@plurid/plurid-ui-state-react';
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
    directory?: string,
) => {
    const dispatchProductAddPlane: DispatchAction<typeof actions.product.addPlane> = (
        payload,
    ) => dispatch(
        actions.product.addPlane(payload),
    );

    const defaultFileSystemPath = os.homedir();
    const planeDirectory = directory
        || state.product.filesDefaultOpenDirectory
        || defaultFileSystemPath;


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


export const removePlane = (
    state: AppState,
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
    planeID: string,
    spaceID?: string,
) => {
    const dispatchProductRemovePlane: DispatchAction<typeof actions.product.removePlane> = (
        payload,
    ) => dispatch(
        actions.product.removePlane(payload),
    );

    dispatchProductRemovePlane({
        planeID,
        spaceID: spaceID || state.product.activeSpace,
    });
}
// #endregion module
