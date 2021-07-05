// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledViewModes {
    theme: Theme;
}

export const StyledViewModes = styled.div<IStyledViewModes>`
    display: flex;
    align-items: center;
`;


export interface IStyledViewMode {
    theme: Theme;
    active: boolean;
}

export const StyledViewMode = styled.div<IStyledViewMode>`
    height: 36px;
    width: 36px;
    border-radius: 20px;
    display: flex;
    align-items: center;
    justify-content: center;

    background-color: ${
        ({
            theme,
            active
        }: IStyledViewMode) => {
            if (active) {
                return theme.backgroundColorSecondary;
            }

            return 'initial';
        }
    };
`;
// #region module
