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
    min-height: 600px;

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


export interface IStyledFilesView {
    splitView: boolean;
}

export const StyledFilesView = styled.div<IStyledFilesView>`
    display: grid;
    grid-template-columns: ${
        ({
            splitView,
        }: IStyledFilesView) => {
            if (splitView) {
                return '1fr 5fr';
            }

            return '1fr';
        }
    };
`;


export const StyledFilesNotFound = styled.div`
    height: 500px;
    display: grid;
    place-content: center;
`;


export const StyledFilesFavorites = styled.div`
`;


export interface IStyledFilesList {
    theme: Theme;
}

export const StyledFilesList = styled.div<IStyledFilesList>`
    height: 500px;
    overflow: scroll;
    padding: 1rem;

    background-color: ${
        ({
            theme,
        }: IStyledFilesList) => theme.backgroundColorSecondary
    };
`;
// #region module
