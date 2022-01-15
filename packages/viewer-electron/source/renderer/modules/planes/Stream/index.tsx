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
        PluridPlaneComponentProperty,
    } from '@plurid/plurid-react';
    // #endregion libraries


    // #region external
    import {
        RecordFilesStreams,
    } from '~renderer-data/interfaces';

    import {
        PluridInputSwitch,
        PluridInputLine,
        PluridCopyableLine,
    } from '~renderer-services/styled';

    import { AppState } from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';
    import selectors from '~renderer-services/state/selectors';
    // import actions from '~renderer-services/state/actions';

    import {
        getLocalIPAddress,
    } from '~renderer-services/utilities/network';
    // #endregion external


    // #region internal
    import {
        StyledStream,
    } from './styled';
    // #endregion internal
// #endregion imports



// #region module
export interface StreamOwnProperties {
    plurid: PluridPlaneComponentProperty;
}

export interface StreamStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
    stateFilesStreams: RecordFilesStreams;
}

export interface StreamDispatchProperties {
}

export type StreamProperties =
    & StreamOwnProperties
    & StreamStateProperties
    & StreamDispatchProperties;


const Stream: React.FC<StreamProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region own
        plurid,
        // #endregion own

        // #region state
        stateGeneralTheme,
        // stateInteractionTheme,
        stateFilesStreams,
        // #endregion state
    } = properties;

    const id = plurid.plane.parameters.id;
    const fileStream = stateFilesStreams[id];
    if (!fileStream) {
        return (<></>);
    }

    const {
        filepath,
        localport,
        url,
        global,
        local,
    } = fileStream;

    const localIP = getLocalIPAddress();

    const fileURL = url || id;
    const localAddress = `http://${localIP}:${localport}/${fileURL}`;
    const globalAddress = `https://viewer.plurid.com/identonym/${fileURL}`;
    // #endregion properties


    // #region render
    return (
        <StyledStream
            theme={stateGeneralTheme}
        >
            <h1>
                stream file
            </h1>

            <div>
                {filepath}
            </div>

            <PluridInputLine
                name="url"
                text={url}
                atChange={() => {}}
            />

            <div>
                <PluridInputSwitch
                    name="local stream"
                    checked={local}
                    atChange={() => {}}
                    theme={stateGeneralTheme}
                />

                {local && (
                    <PluridCopyableLine
                        data={localAddress}
                    />
                )}
            </div>

            <div>
                <PluridInputSwitch
                    name="global stream"
                    checked={global}
                    atChange={() => {}}
                    theme={stateGeneralTheme}
                />

                {global && (
                    <PluridCopyableLine
                        data={globalAddress}
                    />
                )}
            </div>
        </StyledStream>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): StreamStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
    stateFilesStreams: selectors.product.getFilesStreams(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): StreamDispatchProperties => ({
});


const ConnectedStream = connect(
    mapStateToProperties,
    mapDispatchToProperties,
    null,
    {
        context: StateContext,
    },
)(Stream);
// #endregion module



// #region exports
export default ConnectedStream;
// #endregion exports
