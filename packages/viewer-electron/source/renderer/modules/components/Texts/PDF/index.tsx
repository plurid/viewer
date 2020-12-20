// #region imports
    // #region libraries
    import React, {
        useRef,
        useState,
    } from 'react';

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
    // #endregion external


    // #region internal
    import {
        StyledPDF,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
export interface PDFProperties {
    // #region required
        // #region values
        theme: Theme;
        file: string;
        // #endregion values

        // #region methods
        // #endregion methods
    // #endregion required
}

const PDF: React.FC<PDFProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region required
            // #region values
            theme,
            file,
            // #endregion values

            // #region methods
            // #endregion methods
        // #endregion required
    } = properties;
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
        <StyledPDF
            theme={theme}
        >
            <Document
                file={file}
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
        </StyledPDF>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default PDF;
// #endregion exports
