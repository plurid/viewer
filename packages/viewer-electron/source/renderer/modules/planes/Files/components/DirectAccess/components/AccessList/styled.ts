// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledAccessList {
    theme: Theme;
}

export const StyledAccessList = styled.div<IStyledAccessList>`
`;


export const StyledAccessListHead = styled.div`
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.8rem;
    padding: 0.7rem;
    user-select: none;
    cursor: pointer;
`;


export const StyledAccessListBody = styled.div`
    display: grid;
    grid-template-columns: 1fr;
    grid-gap: 1rem;
    padding: 1rem;
    font-size: 0.9rem;
`;


export interface IStyledAccessListItem {
    theme: Theme;
    active: boolean;
}

export const StyledAccessListItem = styled.div<IStyledAccessListItem>`
    cursor: pointer;
    user-select: none;
`;
// #region module
