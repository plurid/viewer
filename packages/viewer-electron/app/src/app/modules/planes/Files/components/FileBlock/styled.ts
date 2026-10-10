// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #endregion libraries
// #endregion imports



// #region module
export interface IStyledFileBlock {
    theme: Theme;
    selected: boolean;
}

export const StyledFileBlock = styled.div<IStyledFileBlock>`
    display: grid;
    justify-items: center;
    align-items: center;
    padding: 0.3rem 0.7rem;
    max-width: 150px;
    min-width: 120px;
    margin: 0 auto;
    word-break: break-all;
    text-align: center;

    background-color: ${
        ({
            theme,
            selected,
        }: IStyledFileBlock) => {
            if (selected) {
                return theme.backgroundColorTertiaryAlpha;
            }

            return 'initial';
        }
    };

    /* :hover {
        background-color: ${
            ({
                theme,
            }: IStyledFileBlock) => theme.backgroundColorPrimary
        };
    } */
`;


export const StyledFileBlockIcon: any = styled.div`
    margin-right: 0.5rem;

    svg {
        height: 40px;
        width: 40px;
    }
`;


export const StyledFileBlockName: any = styled.div`
`;
// #endregion module
