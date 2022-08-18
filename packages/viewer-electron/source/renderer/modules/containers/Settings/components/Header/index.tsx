// #region imports
    // #region libraries
    import React from 'react';

    import {
        AnyAction,
        ThunkDispatch,
    } from '@reduxjs/toolkit';
    import { connect } from 'react-redux';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #endregion libraries


    // #region external
    import {
        PluridFormLeftRight,
        PluridHR,
        PluridLinkButton,
    } from '~renderer-services/styled';

    // import {
    //     commands,
    // } from '~renderer-services/commands';

    import { AppState } from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';
    import selectors from '~renderer-services/state/selectors';
    import actions from '~renderer-services/state/actions';
    // #endregion external


    // #region internal
    import {
        StyledHeader,
        StyledUsername,
    } from './styled';
    // #endregion internal
// #endregion imports



// #region module
export interface HeaderOwnProperties {
}

export interface HeaderStateProperties {
    stateIdentonym: string;
    stateGeneralTheme: Theme,
    stateInteractionTheme: Theme,
}

export interface HeaderDispatchProperties {
    dispatch: ThunkDispatch<{}, {}, AnyAction>;
}

export type HeaderProperties = HeaderOwnProperties
    & HeaderStateProperties
    & HeaderDispatchProperties;

const Header: React.FC<HeaderProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region state
        stateIdentonym,
        stateGeneralTheme,
        // stateInteractionTheme,
        // #endregion state

        // #region dispatch
        dispatch,
        // #endregion dispatch
    } = properties;
    // #endregion properties


    // #region handlers
    const logout = async () => {
        // await dispatch(commands.logout());
    }
    // #endregion handlers


    // #region render
    return (
        <StyledHeader>
            {stateIdentonym && (
                <PluridFormLeftRight>
                    <StyledUsername>
                        {stateIdentonym}
                    </StyledUsername>

                    <PluridLinkButton
                        text="logout"
                        atClick={logout}
                        inline={true}
                        theme={stateGeneralTheme}
                    />
                </PluridFormLeftRight>
            )}

            <PluridHR
                theme={stateGeneralTheme}
            />
        </StyledHeader>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): HeaderStateProperties => ({
    stateIdentonym: selectors.owner.getIdentonym(state),
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): HeaderDispatchProperties => ({
    dispatch,
});


const ConnectedHeader = connect(
    mapStateToProperties,
    mapDispatchToProperties,
    null,
    {
        context: StateContext,
    },
)(Header);
// #endregion module



// #region external
export default ConnectedHeader;
// #endregion external
