// #region imports
    // #region libraries
    import path from 'path';

    import React, {
        useState,
    } from 'react';

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
        PluridIconDelete,
        PluridIconSettings,
        PluridIconInfo,
        PluridIconArrowRight,
    } from '@plurid/plurid-icons-react';
    // #endregion libraries


    // #region external
    import {
        StyledRoundButton,
    } from '~renderer-services/styled';

    import {
        addPlane,
        removePlane,
    } from '~renderer-services/logic/dispatches';

    import { AppState } from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';
    import selectors from '~renderer-services/state/selectors';
    // import actions from '~renderer-services/state/actions';
    // #endregion external


    // #region internal
    import {
        StyledFileTopBar,
        StyledFilename,
        StyledDetail,
    } from './styled';
    // #endregion internal
// #endregion imports



// #region module
export interface FileTopBarOwnProperties {
    planeID: string;
    filepath: string;
    settingsRender?: JSX.Element;
    infoRender?: JSX.Element;
}

export interface FileTopBarStateProperties {
    state: AppState;
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
}

export interface FileTopBarDispatchProperties {
    dispatch: ThunkDispatch<{}, {}, AnyAction>;
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
        planeID,
        filepath,
        settingsRender,
        infoRender,
        // #endregion own

        // #region state
        state,
        stateGeneralTheme,
        // stateInteractionTheme,
        // #endregion state

        // #region dispatch
        dispatch,
        // #endregion dispatch
    } = properties;

    const filename = path.basename(filepath);
    const directory = path.dirname(filepath);

    const buttonCount = 2 + (settingsRender ? 1 : 0) + (infoRender ? 1 : 0);

    const titleAppearTime = 2_500;
    // #endregion properties


    // #region state
    const [
        showDetail,
        setShowDetail,
    ] = useState('');
    // #endregion state


    // #region handlers
    const toggleDetail = (
        name: string,
    ) => {
        if (name !== showDetail) {
            setShowDetail(name);
        } else {
            setShowDetail('');
        }
    }
    // #endregion handlers


    // #region render
    return (
        <StyledFileTopBar
            theme={stateGeneralTheme}
            buttonCount={buttonCount}
        >
            <StyledFilename>
                <PluridIconCopy
                    theme={stateGeneralTheme}
                    title="Copy Filepath"
                    atClick={() => clipboard.copy(filepath)}
                    titleAppearTime={titleAppearTime}
                />

                <div>
                    {filename}
                </div>
            </StyledFilename>

            <PluridIconDelete
                theme={stateGeneralTheme}
                atClick={() => {
                    removePlane(
                        state,
                        dispatch,
                        planeID,
                    );
                }}
                title="Remove Plane"
                titleAppearTime={titleAppearTime}
            />

            {settingsRender && (
                <StyledRoundButton
                    theme={stateGeneralTheme}
                    active={showDetail === 'SETTINGS'}
                    onClick={() => toggleDetail('SETTINGS')}
                >
                    <PluridIconSettings
                        theme={stateGeneralTheme}
                        title="Settings"
                        titleAppearTime={titleAppearTime}
                    />
                </StyledRoundButton>
            )}

            {infoRender && (
                <StyledRoundButton
                    theme={stateGeneralTheme}
                    active={showDetail === 'INFO'}
                    onClick={() => toggleDetail('INFO')}
                >
                    <PluridIconInfo
                        theme={stateGeneralTheme}
                        title="Info"
                        titleAppearTime={titleAppearTime}
                    />
                </StyledRoundButton>
            )}

            <PluridIconArrowRight
                theme={stateGeneralTheme}
                title="View Location"
                atClick={() => {
                    addPlane(
                        state,
                        dispatch,
                        directory,
                    );
                }}
                titleAppearTime={titleAppearTime}
            />

            {showDetail && (
                <StyledDetail
                    theme={stateGeneralTheme}
                >
                    {showDetail === 'SETTINGS' && (
                        <>
                            {settingsRender}
                        </>
                    )}

                    {showDetail === 'INFO' && (
                        <>
                            {infoRender}
                        </>
                    )}
                </StyledDetail>
            )}
        </StyledFileTopBar>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): FileTopBarStateProperties => ({
    state,
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): FileTopBarDispatchProperties => ({
    dispatch,
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
