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

    import EnhancedImage from '@plurid/enhanced-image-react';
    // #endregion libraries


    // #region external
    import {
        Space,
    } from '~renderer-data/interfaces';

    import FileTopBar from '~renderer-components/FileTopBar';

    import {
        getPlaneByID,
    } from '~renderer-services/logic/data';

    import {
        useSize,
    } from '~renderer-services/hooks/file';

    import { AppState } from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';
    import selectors from '~renderer-services/state/selectors';
    // import actions from '~renderer-services/state/actions';
    // #endregion external


    // #region internal
    import {
        StyledImage,
    } from './styled';
    // #endregion internal
// #endregion imports



// #region module
export interface ImageOwnProperties {
    plurid: PluridPlaneComponentProperty;
}

export interface ImageStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
    stateSpaces: Space[];
    stateActiveSpaceID: string;
}

export interface ImageDispatchProperties {
}

export type ImageProperties = ImageOwnProperties
    & ImageStateProperties
    & ImageDispatchProperties;

const Image: React.FC<ImageProperties> = (
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

    const planeData = activePlane.kind === 'image'
        ? activePlane
        : undefined;
    if (!planeData) {
        return (<></>);
    }

    const src = planeData.data.source;
    // #endregion properties


    // #region effects
    const {
        loadedFileSize,
        fileSizeReadable,
    } = useSize(src);
    // #endregion effects


    // #region render
    const FileSettings = (
        <div>
            <div>
                Convert to eimg
            </div>
        </div>
    );

    const FileInfo = (
        <div>
            {loadedFileSize && (
                <div>
                    Size {fileSizeReadable}
                </div>
            )}
        </div>
    );

    return (
        <StyledImage
            theme={stateGeneralTheme}
        >
            <FileTopBar
                filepath={src}
                settingsRender={FileSettings}
                infoRender={FileInfo}
            />

            <EnhancedImage
                src={src}
                theme={stateGeneralTheme.name as any}
            />
        </StyledImage>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): ImageStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
    stateSpaces: selectors.product.getSpaces(state),
    stateActiveSpaceID: selectors.product.getActiveSpace(state),
});


const mapDispatchToProperties = (
    dispatch: ThunkDispatch<{}, {}, AnyAction>,
): ImageDispatchProperties => ({
});


const ConnectedImage = connect(
    mapStateToProperties,
    mapDispatchToProperties,
    null,
    {
        context: StateContext,
    },
)(Image);
// #endregion module



// #region exports
export default ConnectedImage;
// #endregion exports
