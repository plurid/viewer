// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledDirectAccess {
    theme: Theme;
}

export const StyledDirectAccess = styled.div<IStyledDirectAccess>`
`;


export const StyledDirectAccessNotFound = styled.div`
    display: grid;
    place-content: center;
    height: 100%;
`;


export const StyledDirectAccessList = styled.div`
    display: grid;
    grid-template-columns: 1fr;
    grid-gap: 1rem;
    padding: 1rem;
    font-size: 0.9rem;
`;
// #region module
