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
// #region module
