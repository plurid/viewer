// #region imports
    // #region libraries
    import React from 'react';

    import { AnyAction } from 'redux';
    import { connect } from 'react-redux';
    import { ThunkDispatch } from 'redux-thunk';

    import {
        Theme,
    } from '@plurid/plurid-themes';

    import {
        PluridApplication,
    } from '@plurid/plurid-react';
    // #endregion libraries


    // #region external
    import ImagePlane from '~renderer-planes/Image';
    import VideoPlane from '~renderer-planes/Video';
    import TextPlane from '~renderer-planes/Text';
    import FilesPlane from '~renderer-planes/Files';

    import { AppState } from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';
    import selectors from '~renderer-services/state/selectors';
    // import actions from '~renderer-services/state/actions';
    // #endregion external


    // #region internal
    import {
        StyledSpace,
    } from './styled';
    // #endregion internal
// #endregion imports



// #region module
export interface SpaceOwnProperties {
}

export interface SpaceStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
}

export interface SpaceDispatchProperties {
}

export type SpaceProperties = SpaceOwnProperties
    & SpaceStateProperties
    & SpaceDispatchProperties;

const Space: React.FC<SpaceProperties> = (
    properties,
) => {
    // #region properties
    // const {
        // // #region state
        // stateGeneralTheme,
        // stateInteractionTheme,
        // // #endregion state
    // } = properties;
    // #endregion properties


    // #region render
    return (
        <StyledSpace>
            <PluridApplication
                planes={[
                    {
                        route: '/images/1',
                        component: {
                            kind: 'react',
                            element: () => {
                                return (
                                    <ImagePlane />
                                );
                            },
                        },
                    },
                    {
                        route: '/videos/1',
                        component: {
                            kind: 'react',
                            element: () => {
                                return (
                                    <VideoPlane />
                                );
                            },
                        },
                    },
                    {
                        route: '/texts/1',
                        component: {
                            kind: 'react',
                            element: () => {
                                return (
                                    <TextPlane />
                                );
                            },
                        },
                    },
                    {
                        route: '/files/1',
                        component: {
                            kind: 'react',
                            element: () => {
                                return (
                                    <FilesPlane />
                                );
                            },
                        },
                    },
                ]}
                view={[
                    '/images/1',
                    '/videos/1',
                    '/texts/1',
                    '/files/1',
                ]}
            />
        </StyledSpace>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): SpaceStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): SpaceDispatchProperties => ({
});


const ConnectedSpace = connect(
    mapStateToProperties,
    mapDispatchToProperties,
    null,
    {
        context: StateContext,
    },
)(Space);
// #endregion module



// #region exports
export default ConnectedSpace;
// #endregion exports
