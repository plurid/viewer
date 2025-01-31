// #region imports
    // #region libraries
    import React from 'react';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #endregion libraries


    // #region external
    import {
        PluridTextline,
    } from '~renderer-services/styled';
    // #endregion external


    // #region internal
    import {
        StyledSearch,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
export interface SearchProperties {
    // #region required
        // #region values
        theme: Theme;
        searchValue: string;
        setSearchValue: (searchValue: string) => void;
        // #endregion values

        // #region methods
        // #endregion methods
    // #endregion required
}

const Search: React.FC<SearchProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region required
            // #region values
            theme,
            searchValue,
            setSearchValue,
            // #endregion values

            // #region methods
            // #endregion methods
        // #endregion required
    } = properties;
    // #endregion properties


    // #region render
    return (
        <StyledSearch
            theme={theme}
        >
            <PluridTextline
                text={searchValue}
                atChange={(event) => {
                    setSearchValue(event.target.value);
                }}
                placeholder="search"
                level={2}
            />
        </StyledSearch>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default Search;
// #endregion exports
