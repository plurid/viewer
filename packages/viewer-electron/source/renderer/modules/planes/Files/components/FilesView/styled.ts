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
`;


export interface IStyledFilesList {
    theme: Theme;
}

export const StyledFilesList = styled.div<IStyledFilesList>`
    height: 500px;
    overflow: scroll;
    padding: 1rem;
    user-select: none;

    background-color: ${
        ({
            theme,
        }: IStyledFilesList) => theme.backgroundColorSecondary
    };
`;
// #region module
