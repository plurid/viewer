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
    rowLength: number;
}

export const StyledFilesBlockRow = styled.div<IStyledFilesBlockRow>`
    display: grid;
    grid-template-columns: repeat(${({ rowLength }: IStyledFilesBlockRow) => rowLength}, 150px);
    height: 120px;
`;
// #region module
