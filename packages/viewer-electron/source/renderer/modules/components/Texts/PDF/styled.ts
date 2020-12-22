// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledPDF {
    theme: Theme;
    show: boolean;
}

export const StyledPDF = styled.div<IStyledPDF>`
    width: 100%;
    min-height: 900px;
    max-height: 900px;
    overflow: scroll;

    opacity: ${
        ({
            show,
        }: IStyledPDF) => {
            if (show) {
                return '1';
            }

            return '0';
        }
    };
`;
// #region module
