// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledFilesGallery {
    theme: Theme;
}

export const StyledFilesGallery = styled.div<IStyledFilesGallery>`
    height: 500px;
    width: 700px;
    overflow-x: scroll;
`;
// #region module
