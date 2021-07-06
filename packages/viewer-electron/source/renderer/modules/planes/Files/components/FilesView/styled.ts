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


export interface IStyledContextMenu {
    theme: Theme;
}

export const StyledContextMenu = styled.div<IStyledContextMenu>`
    position: absolute;
    width: 300px;
    display: grid;
    grid-template-columns: 1fr;
    grid-gap: 1rem;
    padding: 1rem;
    border-radius: 15px;
    font-size: 0.9rem;
    z-index: 9999;

    background-color: ${
        ({
            theme,
        }: IStyledContextMenu) => theme.backgroundColorTertiary
    };
    box-shadow: ${
        ({
            theme,
        }: IStyledContextMenu) => theme.boxShadowUmbra
    };
`;
// #region module
