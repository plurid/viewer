// #region imports
    // #region libraries
    import React, {
        useState,
        useEffect,
    } from 'react';

    import {
        Provider as ReduxProvider,
    } from 'react-redux';
    // #endregion libraries


    // #region external
    import reduxStore from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';

    // import {
    //     getProduct,
    // } from '~renderer-services/logic/data';

    import View from './View';
    // #endregion external
// #endregion imports



// #region module
const Application: React.FC<any> = () => {
    // #region state
    const [
        store,
        setStore,
    ] = useState(
        reduxStore({}),
    );

    const [
        storeUpdated,
        setStoreUpdated,
    ] = useState(false);
    // #endregion state


    // #region effects
    useEffect(() => {
        const loadData = async () => {
            // const product = await getProduct();

            const emptyStore = reduxStore({});
            const emptyState = emptyStore.getState();

            const newStore = reduxStore(
                {
                    ...emptyState,
                    product: {
                        ...emptyState.product,
                    },
                },
            );

            setStore(newStore);
            setStoreUpdated(true);
        }

        loadData();
    }, []);
    // #endregion effects


    // #region render
    return (
        <ReduxProvider
            store={store}
            context={StateContext}
        >
            {storeUpdated && (
                <View />
            )}
        </ReduxProvider>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default Application;
// #endregion exports
