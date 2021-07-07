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
        StyledDirectAccess,
        StyledDirectAccessNotFound,
        StyledDirectAccessList,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
export interface DirectAccessProperties {
    // #region required
        // #region values
        theme: Theme;
        favorites: string[];
        // #endregion values

        // #region methods
        // #endregion methods
    // #endregion required
}

const DirectAccess: React.FC<DirectAccessProperties> = (
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
        <StyledDirectAccess
            theme={theme}
        >
            {favorites.length === 0 && (
                <StyledDirectAccessNotFound>
                    no favorites
                </StyledDirectAccessNotFound>
            )}

            {favorites.length > 0 && (
                <StyledDirectAccessList>
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
                </StyledDirectAccessList>
            )}
        </StyledDirectAccess>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default DirectAccess;
// #endregion exports
