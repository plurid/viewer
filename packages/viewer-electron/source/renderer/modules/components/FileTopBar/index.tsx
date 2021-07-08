// #region imports
    // #region libraries
    import path from 'path';

    import React from 'react';

    import { AnyAction } from 'redux';
    import { connect } from 'react-redux';
    import { ThunkDispatch } from 'redux-thunk';

    import {
        Theme,
    } from '@plurid/plurid-themes';

    import {
        clipboard,
    } from '@plurid/plurid-functions';

    import {
        PluridIconCopy,
        PluridIconInfo,
        PluridIconArrowRight,
    } from '@plurid/plurid-icons-react';
    // #endregion libraries


    // #region external
    import { AppState } from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';
    import selectors from '~renderer-services/state/selectors';
    // import actions from '~renderer-services/state/actions';
    // #endregion external


    // #region internal
    import {
        StyledFileTopBar,
        StyledFilename,
    } from './styled';
    // #endregion internal
// #endregion imports



// #region module
export interface FileTopBarOwnProperties {
    filepath: string;
}

export interface FileTopBarStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
}

export interface FileTopBarDispatchProperties {
}

export type FileTopBarProperties =
    & FileTopBarOwnProperties
    & FileTopBarStateProperties
    & FileTopBarDispatchProperties;


const FileTopBar: React.FC<FileTopBarProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region own
        filepath,
        // #endregion own

        // #region state
        stateGeneralTheme,
        // stateInteractionTheme,
        // #endregion state
    } = properties;

    const filename = path.basename(filepath);
    // #endregion properties


    // #region render
    return (
        <StyledFileTopBar
            theme={stateGeneralTheme}
        >
            <StyledFilename>
                <PluridIconCopy
                    theme={stateGeneralTheme}
                    title="Copy Filepath"
                    atClick={() => clipboard.copy(filepath)}
                />

                <div>
                    {filename}
                </div>
            </StyledFilename>

            <PluridIconInfo
                theme={stateGeneralTheme}
                title="Info"
            />

            <PluridIconArrowRight
                theme={stateGeneralTheme}
                title="File Location"
            />
        </StyledFileTopBar>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): FileTopBarStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): FileTopBarDispatchProperties => ({
});


const ConnectedFileTopBar = connect(
    mapStateToProperties,
    mapDispatchToProperties,
    null,
    {
        context: StateContext,
    },
)(FileTopBar);
// #endregion module



// #region exports
export default ConnectedFileTopBar;
// #endregion exports
