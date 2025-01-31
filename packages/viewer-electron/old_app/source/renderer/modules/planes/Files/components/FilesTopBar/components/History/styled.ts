// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledHistory {
    theme: Theme;
}

export const StyledHistory = styled.div<IStyledHistory>`
    display: flex;
    align-items: center;
`;
// #region module
