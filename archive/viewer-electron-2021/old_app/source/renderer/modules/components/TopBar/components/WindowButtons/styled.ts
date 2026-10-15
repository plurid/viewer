// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledWindowButtons {
    theme: Theme;
}

export const StyledWindowButtons = styled.div<IStyledWindowButtons>`
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    grid-gap: 0.1rem;
    justify-items: center;
    align-items: center;
    margin: 0 10px;
    -webkit-app-region: no-drag;
`;


export const StyledWindowButton = styled.div`
    display: grid;
    place-content: center;
    width: 15px;
    height: 15px;
    cursor: pointer;
`;
// #region module
