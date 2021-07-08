// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledFileTopBar {
    theme: Theme;
}

export const StyledFileTopBar = styled.div<IStyledFileTopBar>`
    height: 50px;
    display: grid;
    align-items: center;
    grid-template-columns: 1fr 16px 16px;
    grid-gap: 1rem;
    padding: 0 1rem;
`;


export const StyledFilename = styled.div`
    display: grid;
    align-items: center;
    grid-template-columns: 16px 1fr;
    grid-gap: 0.5rem;
`;
// #region module
