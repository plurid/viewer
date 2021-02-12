// #region imports
    // #region libraries
    import {
        createStore,
        applyMiddleware,
    } from 'redux';

    import thunk from 'redux-thunk';

    import {
        composeWithDevTools,
    } from 'redux-devtools-extension';

    // import {
    //     localStorage,
    // } from '@plurid/apps.libraries.logic.utilities';
    // #endregion libraries


    // #region external
    import rootReducer from '../reducers';
    // #endregion external
// #endregion imports



// #region module
export type AppState = ReturnType<typeof rootReducer>;

const store = (preloadedState: any) => {
    const middleware = [ thunk ];

    // const localState = localStorage.loadState();

    // const persistedState = {
    //     product: localState?.product,
    //     themes: localState?.themes,
    //     // user: localState?.user,
    //     views: localState?.views,
    // };

    const _store = createStore(
        rootReducer,
        preloadedState,
        // persistedState || preloadedState,
        composeWithDevTools(
            applyMiddleware(...middleware),
        ),
    );

    _store.subscribe(
        () => {
            console.log('REDUX STATE', _store.getState());
            // const localState = localStorage.loadState();
            // localStorage.saveState({
            //     ...localState,
            //     product: _store.getState().product,
            //     themes: _store.getState().themes,
            //     // user: _store.getState().user,
            //     views: _store.getState().views,
            // });
        },
    );

    return _store;
}
// #endregion module



// #region exports
export default store;
// #endregion exports
