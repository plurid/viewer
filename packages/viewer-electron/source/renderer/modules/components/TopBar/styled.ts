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
            return 'no-drag';
            // if (properties.isDraggable) {
            //     return 'drag';
            // }

            // return 'no-drag';
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
    -webkit-app-region: no-drag;
`;


export const StyledWindowButton = styled.div`
    display: grid;
    place-content: center;
    width: 15px;
    height: 15px;
    cursor: pointer;
`;


export interface IStyledSpaces {
    show: boolean;
}

export const StyledSpaces = styled.div<IStyledSpaces>`
    display: flex;
    align-items: center;
    height: 100%;

    opacity: ${
        (properties: IStyledSpaces) => {
            if (properties.show) {
                return '1';
            }

            return '0.3';
        }
    };
`;


export const StyledSpace = styled.div`
    font-size: 0.9rem;
    max-width: 200px;
    height: 100%;
    /* cursor: pointer; */
    -webkit-app-region: no-drag;
`;


export interface IStyledSpaceName {
    active: boolean;
}

export const StyledSpaceName = styled.div<IStyledSpaceName>`
    max-width: 200px;
    padding: 0.4rem;
    height: 100%;
    white-space: nowrap;
    display: flex;
    align-items: center;

    border-bottom: 1px solid ${
        (properties: IStyledSpaceName) => {
            if (properties.active) {
                return 'white';
            }

            return 'transparent';
        }
    };
`;


export const StyledAddButton = styled.div`
    height: 100%;
    /* cursor: pointer; */
    display: grid;
    place-content: center;
    width: 30px;
    margin-left: 10px;
`;


export const StyledDragZone = styled.div`
    height: 100%;
    min-width: 90px;
    flex: 1;
    -webkit-app-region: drag;
`;
// #region module
