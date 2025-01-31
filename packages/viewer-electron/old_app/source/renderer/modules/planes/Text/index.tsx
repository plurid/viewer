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

    import {
        PluridPlaneComponentProperty,
    } from '@plurid/plurid-react';
    // #endregion libraries


    // #region external
    import {
        Space,
    } from '~renderer-data/interfaces';

    import FileTopBar from '~renderer-components/FileTopBar';
    import FilePath from '~renderer-components/FileInformation/FilePath';
    import FileSize from '~renderer-components/FileInformation/FileSize';

    import Djvu from '~renderer-components/Texts/Djvu';
    import Epub from '~renderer-components/Texts/Epub';
    import PDF from '~renderer-components/Texts/PDF';

    import {
        getPlaneByID,
    } from '~renderer-services/logic/data';

    import { AppState } from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';
    import selectors from '~renderer-services/state/selectors';
    // import actions from '~renderer-services/state/actions';
    // #endregion external


    // #region internal
    import {
        StyledText,
    } from './styled';
    // #endregion internal
// #endregion imports



// #region module
export interface TextOwnProperties {
    plurid: PluridPlaneComponentProperty;
}

export interface TextStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
    stateSpaces: Space[];
    stateActiveSpaceID: string;
}

export interface TextDispatchProperties {
}

export type TextProperties =
    & TextOwnProperties
    & TextStateProperties
    & TextDispatchProperties;


const Text: React.FC<TextProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region required
            // #region values
            plurid,
            // #endregion values

            // #region methods
            // #endregion methods
        // #endregion required

        // #region state
        stateGeneralTheme,
        // stateInteractionTheme,
        stateSpaces,
        stateActiveSpaceID,
        // #endregion state
    } = properties;

    const planeID = plurid.plane.parameters.id;

    const activePlane = getPlaneByID(
        stateSpaces,
        stateActiveSpaceID,
        planeID,
    );
    if (!activePlane) {
        return (<></>);
    }

    const planeData = activePlane.kind === 'text'
        ? activePlane
        : undefined;
    if (!planeData) {
        return (<></>);
    }

    const file = planeData.data.source;
    const type = planeData.data.type;
    // #endregion properties


    // #region render
    let textRender = (<></>);
    switch (type) {
        case '.djvu':
            textRender = (
                <Djvu
                    file={file}
                    theme={stateGeneralTheme}
                />
            );
            break;
        case '.epub':
            textRender = (
                <Epub
                    file={file}
                    theme={stateGeneralTheme}
                />
            );
            break;
        case '.pdf':
            textRender = (
                <PDF
                    file={file}
                    theme={stateGeneralTheme}
                />
            );
            break;
    }

    const FileSettings = (
        <div>
            <div>
                Convert to pluridoc
            </div>
        </div>
    );

    const FileInfo = (
        <div>
            <FilePath
                filepath={file}
            />

            <FileSize
                filepath={file}
            />
        </div>
    );


    return (
        <StyledText
            theme={stateGeneralTheme}
        >
            <FileTopBar
                planeID={planeID}
                filepath={file}
                settingsRender={FileSettings}
                infoRender={FileInfo}
            />

            {textRender}
        </StyledText>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): TextStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
    stateSpaces: selectors.product.getSpaces(state),
    stateActiveSpaceID: selectors.product.getActiveSpace(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): TextDispatchProperties => ({
});


const ConnectedText = connect(
    mapStateToProperties,
    mapDispatchToProperties,
    null,
    {
        context: StateContext,
    },
)(Text);
// #endregion module



// #region exports
export default ConnectedText;
// #endregion exports
