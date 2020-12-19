// #region imports
    // #region libraries
    import React, {
        useRef,
        useState,
    } from 'react';

    import { AnyAction } from 'redux';
    import { connect } from 'react-redux';
    import { ThunkDispatch } from 'redux-thunk';

    import {
        Document,
        Page,
    } from 'react-pdf/dist/esm/entry.webpack';

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


    // #region references
    const ref = useRef<any>(null);
    // #endregion references


    // #region handlers
    const onDocumentLoadSuccess = (
        data: any,
    ) => {
        const {
            numPages,
            loadingTask,
        } = data;

        setNumPages(numPages);

        ref.current = loadingTask;
    }

    const onRenderSuccess = (
    ) => {
        console.log('onRenderSuccess');

        const loadingTask = ref.current;
        console.log('onRenderSuccess', loadingTask);

        if (!loadingTask) {
            return;
        }

        loadingTask.promise.then(
            (
                pdf: any,
            ) => {
                console.log('pdf', pdf);
                var pageNumber = 1;

                pdf.getPage(pageNumber).then(
                    (
                        page: any,
                    ) => {
                        console.log('Page loaded');

                        var scale = 1;
                        var viewport = page.getViewport(scale);

                        console.log('page', page);
                        console.log('viewport', viewport);

                        // Prepare canvas using PDF page dimensions
                        // if (!ref.current) {
                        //     return;
                        // }

                        // console.log('ref.current', ref.current);

                        // const canvas: any = document.getElementById('the-canvas');
                        const canvas: HTMLCanvasElement | null = document.querySelector('.pdf-page canvas');
                        console.log('canvas', canvas);

                        if (!canvas) {
                            return;
                        }

                        const context = canvas.getContext('2d');
                        // canvas.height = viewport.height;
                        // canvas.width = viewport.width;
                        canvas.height = 792;
                        canvas.width = 612;

                        // Render PDF page into canvas context
                        const renderContext = {
                            canvasContext: context,
                            // Use transparent background!
                            background: 'hsl(220, 10%, 26%)',
                            viewport,
                        };

                        const renderTask = page.render(renderContext);
                        console.log('renderTask', renderTask);

                        // renderTask.then(() => {
                        //     console.log('Page rendered');
                        // });
                    }
                );
            },
            (
                reason: any,
            ) => {
                // PDF loading error
                console.error(reason);
            }
        );
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
                    // ref={ref}
                    className="pdf-page"
                    onRenderSuccess={onRenderSuccess}
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
