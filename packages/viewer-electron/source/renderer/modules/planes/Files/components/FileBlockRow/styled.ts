// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledFileBlockRow {
    theme: Theme;
}

export const StyledFileBlockRow = styled.div<IStyledFileBlockRow>`
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr 1fr;
    height: 120px;
`;
// #region module
