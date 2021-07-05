// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledSpace {
    theme: Theme;
}

export const StyledSpace = styled.div<IStyledSpace>`
    height: 100%;
`;


export const StyledSpaceEmpty = styled.div`
    height: 100%;
    display: grid;
    place-content: center;
    line-height: 2;
    text-align: center;
    user-select: none;
`;
// #region module
