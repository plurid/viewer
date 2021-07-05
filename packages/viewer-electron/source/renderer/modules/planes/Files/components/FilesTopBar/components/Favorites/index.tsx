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
    import {
        StyledTopBarButton,
    } from '~renderer-planes/Files/components/FilesTopBar/styled';
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
        viewShowFavorites: boolean;
        setViewShowFavorites: React.Dispatch<React.SetStateAction<boolean>>;
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
            viewShowFavorites,
            setViewShowFavorites,
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
            <StyledTopBarButton
                theme={theme}
                active={viewShowFavorites}
            >
                <PluridIconSpace
                    theme={theme}
                    title="Favorites"
                    atClick={() => setViewShowFavorites(active => !active)}
                />
            </StyledTopBarButton>
        </StyledFavorites>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default Favorites;
// #endregion exports