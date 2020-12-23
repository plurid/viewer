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


export interface IStyledPDFDocument {
    theme: Theme;
    show: boolean;
    inversion: number;
}

export const StyledPDFDocument = styled.div<IStyledPDFDocument>`
    display: flex;
    flex-direction: column;
    align-items: center;
    margin: 0;
    padding: 0;

    width: 100%;
    min-height: 900px;
    max-height: 900px;
    overflow-y: scroll;

    .react-pdf {
        &__Document {
            display: flex;
            flex-direction: column;
            align-items: center;
        }

        &__Page {
            /* max-width: calc(~"100% - 2em"); */
            max-width: calc('100% - 2em');
            box-shadow: 0 0 8px rgba(0, 0, 0, .5);
            margin: 1em;

            canvas {
                min-width: 900px;
                max-width: 100%;
                height: auto !important;
            }
        }

        &__message {
            padding: 20px;
            color: white;
        }
    }

    opacity: ${
        ({
            show,
        }) => {
            if (show) {
                return '1';
            }

            return '0';
        }
    };

    canvas {
        filter: ${
            ({
                inversion,
            }) => `invert(${inversion})`
        };
    }
`;


export interface IStyledUnrenderedPageContainer {
}

export const StyledUnrenderedPageContainer = styled.div<IStyledUnrenderedPageContainer>`
    box-shadow: 0 0 8px rgba(0,0,0,.5);
    height: 663px;
    width: 442px;
    margin: 1em;
`;


export interface IStyledUnrenderedPage {
    inversion: number;
}

export const StyledUnrenderedPage = styled.div<IStyledUnrenderedPage>`
    background: white;
    height: 100%;
    width: 100%;

    filter: ${
        ({
            inversion,
        }) => `invert(${inversion})`
    };
`;
// #region module
