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


export const StyledFilesNotFound = styled.div`
    height: 500px;
    display: grid;
    place-content: center;
`;


export const StyledFilesList = styled.div`
    height: 500px;
    overflow: scroll;
`;
// #region module
