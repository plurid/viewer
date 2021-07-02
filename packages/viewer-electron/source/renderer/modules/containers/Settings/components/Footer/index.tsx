// #region imports
    // #region libraries
    import React from 'react';

    import { AnyAction } from 'redux';
    import { connect } from 'react-redux';
    import { ThunkDispatch } from 'redux-thunk';

    import {
        Theme,
    } from '@plurid/plurid-themes';


    // import {
    //     themes as themesStateService,
    // } from '@plurid/apps.libraries.frontends.state';
    // #endregion libraries


    // #region external
    import {
        PluridFormLeftRight,
        PluridHR,
        PluridLinkButton,
    } from '~renderer-services/styled';

    // import {
    //     databaseResetSettings,
    // } from '../../logic';

    import { AppState } from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';
    import selectors from '~renderer-services/state/selectors';
    import actions from '~renderer-services/state/actions';
    // #endregion external


    // #region internal
    import {
        StyledFooter,
    } from './styled';
    // #endregion internal
// #endregion imports



// #region module
export interface FooterOwnProperties {
}

export interface FooterStateProperties {
    stateGeneralTheme: Theme,
    stateInteractionTheme: Theme,
    stateIdentonym: string;
}

export interface FooterDispatchProperties {
}

export type FooterProperties =
    & FooterOwnProperties
    & FooterStateProperties
    & FooterDispatchProperties;


const Footer: React.FC<FooterProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region state
        stateGeneralTheme,
        // stateInteractionTheme,
        stateIdentonym,
        // #endregion state

        // #region dispatch
        // #endregion dispatch
    } = properties;
    // #endregion properties


    // #region handlers
    const handleReset = () => {
    }
    // #endregion handlers


    // #region render
    return (
        <StyledFooter>
            <PluridHR
                theme={stateGeneralTheme}
            />

            <PluridFormLeftRight>
                <PluridLinkButton
                    text="reset"
                    atClick={handleReset}
                    inline={true}
                    theme={stateGeneralTheme}
                />

                <a
                    href={"https://account.plurid.com"}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                        fontWeight: 'bold',
                    }}
                >
                    account
                </a>
            </PluridFormLeftRight>
        </StyledFooter>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): FooterStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
    stateIdentonym: selectors.owner.getIdentonym(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): FooterDispatchProperties => ({
});


const ConnectedFooter = connect(
    mapStateToProperties,
    mapDispatchToProperties,
        null,
    {
        context: StateContext,
    },
)(Footer);
// #endregion module



// #region exports
export default ConnectedFooter;
// #endregion exports
