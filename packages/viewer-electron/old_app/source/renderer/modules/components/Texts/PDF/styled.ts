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
    disabledPointer: boolean;
}

export const StyledPDF = styled.div<IStyledPDF>`
    width: 100%;
    min-height: 900px;
    max-height: 900px;
    position: relative;

    iframe {
        position: absolute;
        border: none;
        width: 100%;
        height: 100%;

        pointer-events: ${
            ({
                disabledPointer,
            }) => {
                if (disabledPointer) {
                    return 'auto';
                }

                return 'all';
            }
        };
    }
`;
// #region module
