// #region imports
    // #region libraries
    import styled from 'styled-components';
    // #endregion libraries
// #endregion imports



// #region module
export const StyledSettingsView = styled.div`
    display: grid;
    justify-content: center;
    padding: 4rem;
    height: 100%;
    width: 100%;
    user-select: none;
    font-size: 0.9rem;
`;


export const StyledSettingsContainer = styled.div`
    text-align: left;
    height: 100%;
    width: 310px;
    overflow: hidden;

    h1 {
        text-align: center;
        margin-bottom: 40px;
    }

    @media (max-height: 790px) {
        overflow: initial;
    }
`;


export const StyledSettings = styled.div`
    display: grid;
    grid-template-columns: 1fr;
    grid-template-rows: 50px 450px 50px;

    height: 100%;
    width: 100%;

    h2 {
        margin-top: 30px;
        margin-bottom: 10px;
    }
`;
// #endregion module
