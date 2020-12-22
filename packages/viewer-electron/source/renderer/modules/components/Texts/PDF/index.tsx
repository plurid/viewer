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


    // #region state
    const [
        renderComplete,
        setRenderComplete,
    ] = useState(true);

    const [
        numPages,
        setNumPages,
    ] = useState(null);

    const [
        currentPage,
        setCurrentPage,
    ] = useState(1);
    // #endregion state


    // #region handlers
    const handlePdfPage = (
        pdf: any,
        pageNumber: number,
    ) => {
        pdf.getPage(pageNumber).then(
            (
                page: any,
            ) => {
                const scale = 1;
                const viewport = page.getViewport({
                    scale,
                });

                const canvas: HTMLCanvasElement | null = document
                    .querySelector(`.pdf-page-${pageNumber} canvas`);

                if (!canvas) {
                    return;
                }

                const context = canvas.getContext('2d');
                canvas.height = viewport.height || viewport.viewBox[3];
                canvas.width = viewport.width || viewport.viewBox[2];

                // Render PDF page into canvas context
                const renderContext = {
                    canvasContext: context,
                    background: theme.backgroundColorSecondary,
                    viewport,
                };

                page.render(renderContext);

                setRenderComplete(true);
            }
        );
    }

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
        pageNumber: number,
    ) => {
        const loadingTask = ref.current;
        if (!loadingTask) {
            return;
        }

        loadingTask.promise.then(
            (
                pdf: any,
            ) => handlePdfPage(pdf, pageNumber),
        );
    }
    // #endregion handlers


    // #region render
    return (
        <StyledPDF
            theme={theme}
            show={renderComplete}
        >
            <Document
                file={file}
                onLoadSuccess={onDocumentLoadSuccess}
            >
                {
                    Array.apply(null, Array(numPages))
                        .map((x, i) => i + 1)
                        .map(page => (
                            <Page
                                key={page}
                                pageNumber={page}
                                className={`pdf-page-${page}`}
                                onRenderSuccess={() => onRenderSuccess(page)}
                            />
                        ))
                }
            </Document>
        </StyledPDF>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default PDF;
// #endregion exports
