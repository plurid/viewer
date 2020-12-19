// #region imports
    // #region libraries
    import React, {
        useState,
    } from 'react';

    import { AnyAction } from 'redux';
    import { connect } from 'react-redux';
    import { ThunkDispatch } from 'redux-thunk';

    import { Document, Page } from 'react-pdf/dist/esm/entry.webpack';
    import 'react-pdf/dist/esm/Page/AnnotationLayer.css';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #endregion libraries


    // #region external
    import { AppState } from '~renderer-services/state/store';
    import StateContext from '~renderer-services/state/context';
    import selectors from '~renderer-services/state/selectors';
    // import actions from '~renderer-services/state/actions';
    // #endregion external


    // #region internal
    import {
        StyledText,
    } from './styled';

    import pdf from './assets/example.pdf';
    // #endregion internal
// #endregion imports



// #region module
export interface TextOwnProperties {
}

export interface TextStateProperties {
    stateGeneralTheme: Theme;
    stateInteractionTheme: Theme;
}

export interface TextDispatchProperties {
}

export type TextProperties = TextOwnProperties
    & TextStateProperties
    & TextDispatchProperties;

const Text: React.FC<TextProperties> = (
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


    // #region handlers
    const onDocumentLoadSuccess = ({ numPages }: any) => {
        setNumPages(numPages);
    }
    // #endregion handlers


    // #region state
    const [
        numPages,
        setNumPages,
    ] = useState(null);
    const [
        pageNumber,
        setPageNumber,
    ] = useState(1);
    // #endregion state


    // #region render
    return (
        <StyledText>
            <Document
                file={pdf}
                onLoadSuccess={onDocumentLoadSuccess}
            >
                <Page
                    pageNumber={pageNumber}
                />
            </Document>

            <p>Page {pageNumber} of {numPages}</p>
        </StyledText>
    );
    // #endregion render
}


const mapStateToProperties = (
    state: AppState,
): TextStateProperties => ({
    stateGeneralTheme: selectors.themes.getGeneralTheme(state),
    stateInteractionTheme: selectors.themes.getInteractionTheme(state),
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
