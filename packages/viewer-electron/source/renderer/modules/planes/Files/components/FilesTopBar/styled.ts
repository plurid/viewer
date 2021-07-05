// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledFilesTopBar {
    theme: Theme;
}

export const StyledFilesTopBar = styled.div<IStyledFilesTopBar>`
    height: 50px;
    margin: 1rem;
    display: flex;
    grid-gap: 1rem;
    align-items: center;
    justify-content: space-between;
`;


export const StyledFilesTopBarCenter = styled.div`
    height: 50px;
    margin: 1rem;
    display: flex;
    grid-gap: 1rem;
    align-items: center;
`;


export interface IStyledTopBarButton {
    theme: Theme;
    active?: boolean;
    disabled?: boolean;
}

export const StyledTopBarButton = styled.div<IStyledTopBarButton>`
    height: 36px;
    width: 36px;
    border-radius: 20px;
    display: flex;
    align-items: center;
    justify-content: center;

    background-color: ${
        ({
            theme,
            active,
        }: IStyledTopBarButton) => {
            if (active) {
                return theme.backgroundColorSecondary;
            }

            return 'initial';
        }
    };

    pointer-events: ${
        ({
            disabled,
        }: IStyledTopBarButton) => {
            if (disabled) {
                return 'none';
            }

            return 'initial';
        }
    };
    opacity: ${
        ({
            disabled,
        }: IStyledTopBarButton) => {
            if (disabled) {
                return '0.3';
            }

            return '1';
        }
    };
`;
// #region module
