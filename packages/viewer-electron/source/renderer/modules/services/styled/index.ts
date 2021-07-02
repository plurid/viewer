// #region imports
    // #region libraries
    import styled, {
        createGlobalStyle,
    } from 'styled-components';

    import {
        Theme,
    } from '@plurid/plurid-themes';

    import {
        universal,
    } from '@plurid/plurid-ui-components-react';
    // #endregion libraries
// #endregion imports



// #region module
const {
    buttons: {
        PureButton: PluridPureButton,
        LinkButton: PluridLinkButton,
    },
    form: {
        FormLeftRight: PluridFormLeftRight,
        Formbutton: PluridFormbutton,
        Formitem: PluridFormitem,
        Formline: PluridFormline,
    },
    general: {
        GlobalStyles: PluridGlobalStyles,
    },
    inputs: {
        Textline: PluridTextline,
        Switch: PluridSwitch,
        Dropdown: PluridDropdown,
        InputSwitch: PluridInputSwitch,
        InputLine: PluridInputLine,
    },
    typography: {
        Heading: PluridHeading,
    },
    markers: {
        HR: PluridHR,
        Spinner: PluridSpinner,
    },
    varia: {
        CopyableLine: PluridCopyableLine,
    },
} = universal;



export interface IGlobalStyles {
    theme: Theme;
}

const GlobalStyles = createGlobalStyle<IGlobalStyles>`
    *, *::after, *::before {
        box-sizing: border-box;
    }

    html {
        height: 100%;
    }

    body {
        height: 100%;
        overflow: hidden;
        margin: 0;
        padding: 0;
        font-family: ${(props: IGlobalStyles) => {
            return props.theme.fontFamilySansSerif;
        }};
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        color: ${
            ({
                theme,
            }: IGlobalStyles) => theme.colorPrimary
        };

        background-color: ${(props: IGlobalStyles) => {
            return props.theme.backgroundColorPrimary;
        }};
        background: radial-gradient(
            ellipse at 50% 60%,
            ${(props: IGlobalStyles) => {
                if (props.theme.type === 'dark') {
                    return props.theme.backgroundColorTertiary;
                }
                return props.theme.backgroundColorPrimary;
            }},
            ${(props: IGlobalStyles) => {
                if (props.theme.type === 'dark') {
                    return props.theme.backgroundColorPrimary;
                }
                return props.theme.backgroundColorTertiary;
            }}
        );
    }

    a {
        color: inherit;
        text-decoration: none;
    }

    #viewer {
        height: 100%;
        overflow: auto;
    }
`;


const StyledH2Heading = styled(PluridHeading)`
    font-size: 1.5rem;
    text-align: center;
    margin: 0;
    margin-bottom: 1.5rem;
`;


const StyledH3Heading = styled(PluridHeading)`
    font-size: 1.2rem;
    text-align: center;
    margin: 0;
    margin-bottom: 1.2rem;
`;


const StyledPluridFormLeftRight = styled(PluridFormLeftRight)`
    margin-bottom: 1.5rem;
`;


const StyledPluridFormbutton = styled(PluridFormbutton)`
    padding: 0;
    margin-bottom: 1.5rem;
`;
// #endregion module



// #region exports
export {
    PluridPureButton,
    PluridLinkButton,

    StyledPluridFormLeftRight,
    PluridFormLeftRight,
    StyledPluridFormbutton,
    PluridFormbutton,

    PluridGlobalStyles,
    GlobalStyles,

    PluridSwitch,
    PluridDropdown,
    PluridInputSwitch,
    PluridInputLine,

    PluridHeading,

    PluridSpinner,


    PluridFormitem,
    PluridFormline,

    PluridTextline,

    PluridHR,

    PluridCopyableLine,


    StyledH2Heading,
    StyledH3Heading,
};
// #endregion exports
