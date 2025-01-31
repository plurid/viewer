// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledVideo {
    theme: Theme;
}

export const StyledVideo = styled.div<IStyledVideo>`
    font-family: ${
        ({
            theme,
        }: IStyledVideo) => theme.fontFamilySansSerif
    };
`;
// #region module
