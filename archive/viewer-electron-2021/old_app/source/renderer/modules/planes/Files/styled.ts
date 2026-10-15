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


export interface IStyledFilesZone {
    splitView: boolean;
}

export const StyledFilesZone = styled.div<IStyledFilesZone>`
    display: grid;
    grid-template-columns: ${
        ({
            splitView,
        }: IStyledFilesZone) => {
            if (splitView) {
                return '1fr 5fr';
            }

            return '1fr';
        }
    };
`;


export interface IStyledFilesContainer {
    theme: Theme;
}

export const StyledFilesContainer = styled.div<IStyledFilesContainer>`
    height: 500px;
    background-color: ${
        ({
            theme,
        }: IStyledFilesContainer) => theme.backgroundColorSecondary
    };
`;
// #region module
