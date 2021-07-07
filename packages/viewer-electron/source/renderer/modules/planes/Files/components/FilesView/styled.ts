// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledFilesView {
    theme: Theme;
}

export const StyledFilesView = styled.div<IStyledFilesView>`
    position: relative;

    background-color: ${
        ({
            theme,
        }: IStyledFilesView) => theme.backgroundColorSecondary
    };
`;
// #region module
