// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledSpaceButton {
    theme: Theme;
}

export const StyledSpaceButton = styled.div<IStyledSpaceButton>`
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
// #region module
