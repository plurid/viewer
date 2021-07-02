// #region imports
    // #region libraries
    import styled from 'styled-components';
    // #endregion libraries


    // #region external
    import {
        PluridFormline,
    } from '~renderer-services/styled';
    // #endregion external
// #endregion imports



// #region module
export const StyledBody = styled.div`
    overflow: auto;
    padding: 0 1rem;
    font-size: 0.8rem;
`;


export const StyledPluridFormline = styled(PluridFormline)`
    padding: 0;
    min-height: 3rem;
`;


export const StyledFormline = styled.div`
    padding: 0;
    min-height: 3rem;
    display: flex;
    align-items: center;
`;
// #endregion module
