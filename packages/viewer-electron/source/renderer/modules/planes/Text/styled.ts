// #region imports
    // #region libraries
    import styled from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #region libraries
// #region imports



// #region module
export interface IStyledText {
    theme: Theme;
}

export const StyledText = styled.div<IStyledText>`
    display: flex;
    flex-direction: column;
    align-items: center;
    margin: 1em 0;
    padding: 10px;

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
                max-width: 100%;
                height: auto !important;
            }
        }

        &__message {
            padding: 20px;
            color: white;
        }
    }
`;
// #region module
