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


export interface IStyledFilesSelection {
    theme: Theme;
}

export const StyledFilesSelection = styled.div<IStyledFilesSelection>`
    position: absolute;
    z-index: 999;
    pointer-events: none;
    background-color: ${
        ({
            theme,
        }: IStyledFilesSelection) => theme.backgroundColorTertiaryAlpha
    };
    border: 2px solid ${
        ({
            theme,
        }: IStyledFilesSelection) => theme.backgroundColorQuaternaryAlpha
    };
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
