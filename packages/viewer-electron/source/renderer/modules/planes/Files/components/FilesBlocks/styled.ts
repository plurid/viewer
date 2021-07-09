// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledFilesBlocks {
    theme: Theme;
}

export const StyledFilesBlocks = styled.div<IStyledFilesBlocks>`
    padding: 1rem;
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr 1fr;
`;
// #region module
