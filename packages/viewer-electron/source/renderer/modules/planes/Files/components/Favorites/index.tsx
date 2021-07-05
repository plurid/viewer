// #region imports
    // #region libraries
    import path from 'path';

    import React from 'react';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #endregion libraries


    // #region external
    // #endregion external


    // #region internal
    import {
        StyledFavorites,
        StyledFavoritesNotFound,
        StyledFavoritesList,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
export interface FavoritesProperties {
    // #region required
        // #region values
        theme: Theme;
        favorites: string[];
        // #endregion values

        // #region methods
        // #endregion methods
    // #endregion required
}

const Favorites: React.FC<FavoritesProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region required
            // #region values
            theme,
            favorites,
            // #endregion values

            // #region methods
            // #endregion methods
        // #endregion required
    } = properties;
    // #endregion properties


    // #region render
    return (
        <StyledFavorites
            theme={theme}
        >
            {favorites.length === 0 && (
                <StyledFavoritesNotFound>
                    no favorites
                </StyledFavoritesNotFound>
            )}

            {favorites.length > 0 && (
                <StyledFavoritesList>
                    {favorites.map(favorite => {
                        const favoriteName = path.basename(favorite);

                        return (
                            <div
                                key={favorite}
                            >
                                {favoriteName}
                            </div>
                        );
                    })}
                </StyledFavoritesList>
            )}
        </StyledFavorites>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default Favorites;
// #endregion exports
