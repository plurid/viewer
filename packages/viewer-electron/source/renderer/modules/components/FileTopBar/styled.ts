// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledFileTopBar {
    theme: Theme;
    buttonCount: number;
}

export const StyledFileTopBar = styled.div<IStyledFileTopBar>`
    height: 50px;
    display: grid;
    grid-template-columns: 1fr repeat(${({buttonCount}: IStyledFileTopBar) => buttonCount}, 32px);
    align-items: center;
    justify-items: center;
    font-size: 0.8rem;
    grid-gap: 1rem;
    padding: 0 1rem;
`;


export const StyledFilename = styled.div`
    display: grid;
    align-items: center;
    grid-template-columns: 16px 1fr;
    grid-gap: 0.5rem;
    justify-self: left;
    padding: 0 0.7rem;
`;


export interface IStyledDetail {
    theme: Theme;
}

export const StyledDetail = styled.div<IStyledDetail>`
    position: absolute;
    top: 60px;
    right: 20px;
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
        }: IStyledDetail) => theme.backgroundColorTertiary
    };
    box-shadow: ${
        ({
            theme,
        }: IStyledDetail) => theme.boxShadowUmbra
    };
`;
// #region module
