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
    } from './styled';

    import AccessList from './components/AccessList';
    // #endregion internal
// #region imports



// #region module
export interface DirectAccessProperties {
    // #region required
        // #region values
        theme: Theme;
        favorites: string[];
        recents: string[];
        viewDirectory: string;
        showFavorites: boolean;
        showRecent: boolean;
        // #endregion values

        // #region methods
        setViewDirectory: (directory: string) => void;
        toggleFavorites: () => void;
        toggleRecent: () => void;
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
            recents,
            viewDirectory,
            showFavorites,
            showRecent,
            // #endregion values

            // #region methods
            setViewDirectory,
            toggleFavorites,
            toggleRecent
            // #endregion methods
        // #endregion required
    } = properties;
    // #endregion properties


    // #region handlers
    const generateAccessListItems = (
        list: string[],
    ) => {
        const accessList = list.map(directory => {
            const name = path.basename(directory);

            return {
                name,
                directory,
            };
        });

        return accessList;
    }
    // #endregion handlers


    // #region render
    return (
        <StyledDirectAccess
            theme={theme}
        >
            <AccessList
                theme={theme}
                title="Favorites"
                items={generateAccessListItems(favorites)}
                viewDirectory={viewDirectory}
                show={showFavorites}

                setViewDirectory={setViewDirectory}
                toggleShow={() => toggleFavorites()}
            />

            <AccessList
                theme={theme}
                title="Recent"
                items={generateAccessListItems(recents)}
                viewDirectory={viewDirectory}
                show={showRecent}

                setViewDirectory={setViewDirectory}
                toggleShow={() => toggleRecent()}
            />
        </StyledDirectAccess>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default DirectAccess;
// #endregion exports
