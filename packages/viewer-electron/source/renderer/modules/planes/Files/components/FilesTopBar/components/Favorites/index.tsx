// #region imports
    // #region libraries
    import React from 'react';

    import {
        Theme,
    } from '@plurid/plurid-themes';

    import {
        PluridIconSpace,
    } from '@plurid/plurid-icons-react';
    // #endregion libraries


    // #region external
    // #endregion external


    // #region internal
    import {
        StyledFavorites,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
export interface FavoritesProperties {
    // #region required
        // #region values
        theme: Theme;
        // #endregion values

        // #region methods
        // #endregion methods
    // #endregion required

    // #region optional
        // #region values
        // #endregion values

        // #region methods
        // #endregion methods
    // #endregion optional
}

const Favorites: React.FC<FavoritesProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region required
            // #region values
            theme,
            // #endregion values

            // #region methods
            // #endregion methods
        // #endregion required

        // #region optional
            // #region values
            // #endregion values

            // #region methods
            // #endregion methods
        // #endregion optional
    } = properties;
    // #endregion properties


    // #region render
    return (
        <StyledFavorites
            theme={theme}
        >
            <PluridIconSpace
                theme={theme}
                title="Favorites"
            />
        </StyledFavorites>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default Favorites;
// #endregion exports
