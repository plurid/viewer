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
    },
    general: {
        GlobalStyles: PluridGlobalStyles,
    },
    inputs: {
        Switch: PluridSwitch,
        Dropdown: PluridDropdown,
        InputSwitch: PluridInputSwitch,
        InputLine: PluridInputLine,
    },
    typography: {
        Heading: PluridHeading,
    },
} = universal;



export interface IGlobalStyles {
    theme: Theme;
}

const GlobalStyles = createGlobalStyle<IGlobalStyles>`
    body {
        background: radial-gradient(ellipse at center,
            ${({ theme }: IGlobalStyles) => {
                if (theme.type === 'dark') {
                    return theme.backgroundColorTertiary;
                } else {
                    return theme.backgroundColorPrimary;
                }
            }} 0%,
            ${({ theme }: IGlobalStyles) => {
                if (theme.type === 'dark') {
                    return theme.backgroundColorPrimary;
                } else {
                    return theme.backgroundColorTertiary;
                }
            }} 100%
        );

        overflow: hidden;

        /* to be used in production (?) */
        /* cursor: none; */
    }

    #ceris {
        padding: 4rem;
        box-sizing: border-box;
        overflow: auto;
        height: 100%;

        overflow-y: overlay;
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

    StyledH2Heading,
    StyledH3Heading,
};
// #endregion exports
