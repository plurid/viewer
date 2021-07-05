// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledFilesTopBar {
    theme: Theme;
}

export const StyledFilesTopBar = styled.div<IStyledFilesTopBar>`
    height: 50px;
    margin: 1rem;
    display: flex;
    grid-gap: 1rem;
    align-items: center;
    justify-content: space-between;
`;


export const StyledFilesTopBarCenter = styled.div`
    height: 50px;
    margin: 1rem;
    display: flex;
    grid-gap: 1rem;
    align-items: center;
`;
// #region module
