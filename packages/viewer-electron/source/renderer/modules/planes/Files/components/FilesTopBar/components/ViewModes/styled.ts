// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledViewModes {
    theme: Theme;
}

export const StyledViewModes = styled.div<IStyledViewModes>`
    display: flex;
    grid-gap: 1rem;
    align-items: center;
`;
// #region module
