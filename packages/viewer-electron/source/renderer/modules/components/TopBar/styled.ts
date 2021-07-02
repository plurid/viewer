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
    height: 40px;
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


export interface IStyledSpaces {
    show: boolean;
}

export const StyledSpaces = styled.div<IStyledSpaces>`
    display: flex;
    align-items: center;
    height: 100%;
    margin-left: 85px;

    opacity: ${
        (properties: IStyledSpaces) => {
            if (properties.show) {
                return '1';
            }

            return '0.3';
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
