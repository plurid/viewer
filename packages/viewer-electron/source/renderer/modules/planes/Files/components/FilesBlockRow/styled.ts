// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledFilesBlockRow {
    theme: Theme;
}

export const StyledFilesBlockRow = styled.div<IStyledFilesBlockRow>`
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr 1fr;
    height: 120px;
`;
// #region module
