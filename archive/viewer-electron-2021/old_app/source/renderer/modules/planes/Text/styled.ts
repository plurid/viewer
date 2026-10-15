// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledText {
    theme: Theme;
}

export const StyledText = styled.div<IStyledText>`
    font-family: ${
        ({
            theme,
        }: IStyledText) => theme.fontFamilySansSerif
    };
`;
// #region module
