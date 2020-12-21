// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledTopBar {
    theme: Theme;
    show: boolean;
    isDraggable: boolean;
}

export const StyledTopBar = styled.div<IStyledTopBar>`
    -webkit-app-region: ${
        (properties: IStyledTopBar) => {
            if (properties.isDraggable) {
                return 'drag';
            }

            return 'no-drag';
        }
    };
    -webkit-user-select: none;

    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 45px;
    z-index: 9999;

    display: grid;
    grid-template-columns: 90px auto;
    grid-gap: 1rem;
    align-items: center;

    background-color: ${
        (properties: IStyledTopBar) => {
            if (properties.show) {
                return properties.theme.backgroundColorDark;
            }

            return 'transparent';
        }
    };
`;


export const StyledWindowButtons = styled.div`
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    grid-gap: 0.1rem;
    justify-items: center;
    align-items: center;
    margin: 0 10px;
`;


export const StyledWindowButton = styled.div`
    display: grid;
    place-content: center;
    width: 15px;
    height: 15px;
`;


export interface IStyledSpaces {
    show: boolean;
}

export const StyledSpaces = styled.div<IStyledSpaces>`
    display: flex;
    align-items: center;

    opacity: ${
        (properties: IStyledSpaces) => {
            if (properties.show) {
                return '1';
            }

            return '0.3';
        }
    };
`;


export interface IStyledSpace {
    active: boolean;
}

export const StyledSpace = styled.div<IStyledSpace>`
    margin-right: 15px;
    max-width: 200px;
    padding: 0.4rem;
    cursor: pointer;

    border-bottom: 1px solid ${
        (properties: IStyledSpace) => {
            if (properties.active) {
                return 'white';
            }

            return 'transparent';
        }
    };
`;
// #region module
