// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledImage {
    theme: Theme;
}

export const StyledImage = styled.div<IStyledImage>`
    font-family: ${
        ({
            theme,
        }: IStyledImage) => theme.fontFamilySansSerif
    };
`;
// #region module
