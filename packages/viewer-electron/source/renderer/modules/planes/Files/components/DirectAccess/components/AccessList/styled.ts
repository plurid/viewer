// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledAccessList {
    theme: Theme;
}

export const StyledAccessList = styled.div<IStyledAccessList>`
`;


export const StyledAccessListHead = styled.div`
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.8rem;
    padding: 0.4rem 1.1rem;
    user-select: none;
    cursor: pointer;
`;


export const StyledAccessListBody = styled.div`
    display: grid;
    grid-template-columns: 1fr;
    font-size: 0.9rem;
`;


export interface IStyledAccessListItem {
    theme: Theme;
    active: boolean;
}

export const StyledAccessListItem = styled.div<IStyledAccessListItem>`
    display: flex;
    align-items: center;
    cursor: pointer;
    user-select: none;
    border-radius: 15px;
    padding: 0.4rem 0.8rem;
    margin: 0.3rem 1.1rem;
    margin-top: 0;

    background-color: ${
        ({
            theme,
            active,
        }: IStyledAccessListItem) => {
            if (active) {
                return theme.backgroundColorSecondary;
            }

            return 'initial';
        }
    };
`;


export const StyledAccessListIcon = styled.div`
    margin-right: 0.5rem;

    svg {
        height: 20px;
        width: 20px;
    }
`;
// #region module
