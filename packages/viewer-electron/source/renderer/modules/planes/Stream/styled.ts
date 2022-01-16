// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledStream {
    theme: Theme;
}

export const StyledStream = styled.div<IStyledStream>`
    font-family: ${
        ({
            theme,
        }: IStyledStream) => theme.fontFamilySansSerif
    };
    padding: 4rem;
`;
// #region module
