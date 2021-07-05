// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #endregion libraries
// #endregion imports



// #region module
export interface IStyledFileItem {
    theme: Theme;
}

export const StyledFileItem = styled.div<IStyledFileItem>`
    display: flex;
    align-items: center;
    padding: 0.3rem 0.7rem;

    :hover {
        background: ${
            ({
                theme,
            }: IStyledFileItem) => theme.backgroundColorSecondary
        };
    }
`;


export const StyledFileItemIcon: any = styled.div`
    margin-right: 0.5rem;

    svg {
        height: 20px;
        width: 20px;
    }
`;


export const StyledFileItemName: any = styled.div`
`;
// #endregion module
