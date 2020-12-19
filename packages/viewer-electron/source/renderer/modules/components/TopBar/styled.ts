// #region imports
    // #region libraries
    import styled from 'styled-components';
    // #endregion libraries
// #endregion imports



// #region module
export const StyledTopBar: any = styled.div`
    -webkit-app-region: drag;

    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 40px;
    z-index: 9999;
    background-color: ${(props: any) => {
        if (props.mouseOver) {
            return props.theme.backgroundColorDark;
        }
        return 'transparent';
    }};
`;
// #endregion module
