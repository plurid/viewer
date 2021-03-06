// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledUnknown {
    theme: Theme;
}

export const StyledUnknown = styled.div<IStyledUnknown>`
    font-family: ${
        ({
            theme,
        }: IStyledUnknown) => theme.fontFamilySansSerif
    };
`;
// #region module
