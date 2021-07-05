// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledDirectoryPath {
    theme: Theme;
}

export const StyledDirectoryPath = styled.div<IStyledDirectoryPath>`
    width: 800px;
    margin: 0 auto;
    padding: 2rem;

    @media (max-width: 900px) {
        width: 100%;
    }
`;
// #region module
