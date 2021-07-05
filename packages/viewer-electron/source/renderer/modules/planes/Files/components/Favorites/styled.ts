// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledFavorites {
    theme: Theme;
}

export const StyledFavorites = styled.div<IStyledFavorites>`
`;


export const StyledFavoritesNotFound = styled.div`
    display: grid;
    place-content: center;
    height: 100%;
`;


export const StyledFavoritesList = styled.div`
    display: grid;
    grid-template-columns: 1fr;
    grid-gap: 1rem;
    padding: 1rem;
    font-size: 0.9rem;
`;
// #region module
