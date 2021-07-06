// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledActions {
    theme: Theme;
}

export const StyledActions = styled.div<IStyledActions>`
`;


export interface IStyledActionsMenu {
    theme: Theme;
}

export const StyledActionsMenu = styled.div<IStyledActionsMenu>`
    position: absolute;
    top: 70px;
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
        }: IStyledActionsMenu) => theme.backgroundColorTertiary
    };
    box-shadow: ${
        ({
            theme,
        }: IStyledActionsMenu) => theme.boxShadowUmbra
    };
`;
// #region module
