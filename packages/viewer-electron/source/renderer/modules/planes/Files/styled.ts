// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledFiles {
    theme: Theme;
}

export const StyledFiles = styled.div<IStyledFiles>`
    font-family: ${
        ({
            theme,
        }: IStyledFiles) => theme.fontFamilySansSerif
    };

    ul {
        list-style: none;
        padding: 0;
        margin: 0;
    }
`;
// #region module
