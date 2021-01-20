// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledDjvu {
    theme: Theme;
}

export const StyledDjvu = styled.div<IStyledDjvu>`
    height: 900px;
`;
// #region module
