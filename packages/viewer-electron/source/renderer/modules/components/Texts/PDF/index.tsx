// #region imports
    // #region libraries
    import React, {
        useEffect,
        useRef,
        useState,
    } from 'react';

    import {
        Document,
        Page,
    } from 'react-pdf/dist/esm/entry.webpack';

    import 'react-pdf/dist/esm/Page/AnnotationLayer.css';

    import {
        PDFPageProxy,
    } from 'pdfjs-dist';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #endregion libraries


    // #region external
    import {
        PluridSpinner,
    } from '~renderer-services/styled';
    // #endregion external


    // #region internal
    import {
        StyledPDF,
        StyledUnrenderedPageContainer,
        StyledUnrenderedPage,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
const createRange = (
    start: number,
    end: number | null,
): number[] => {
    const endNumber = end || 1;

    const data = Array
        .apply(null, Array(endNumber))
        .map((_, i) => start + i);

    return data;
}


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

    const inversion = 1;
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
    ] = useState<number | null>(null);

    const [
        currentPage,
        setCurrentPage,
    ] = useState(1);

    const [
        renderPages,
        setRenderPages,
    ] = useState(
        createRange(
            1, 1,
        ),
    );

    const [
        allRenderPages,
        setAllRenderPages,
    ] = useState(
        createRange(
            1, 1,
        ),
    );
    // #endregion state


    // #region handlers
    const handlePdfPage = (
        pdf: any,
        pageNumber: number,
    ) => {
        pdf.getPage(pageNumber).then(
            (
                page: PDFPageProxy,
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
                if (!context) {
                    return;
                }
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                // Render PDF page into canvas context
                const renderContext: any = {
                    canvasContext: context,
                    // background: theme.backgroundColorSecondary,
                    viewport,
                };

                page.render(renderContext);

                setRenderComplete(true);
            }
        );


        pdf.getPage(pageNumber).then(
            (
                page: any,
            ) => {
                page.getOperatorList().then(
                    (
                        opList: any,
                    ) => {
                        console.log(opList);
                    }
                );
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


    // #region effects
    useEffect(() => {
        if (!numPages) {
            return;
        }

        setAllRenderPages(
            createRange(
                1, numPages,
            ),
        );

        if (numPages < 20) {
            setRenderPages(
                createRange(
                    1, numPages,
                ),
            );
            return;
        }

        setRenderPages(
            createRange(
                20, 40,
            ),
        );
    }, [
        numPages,
    ]);
    // #endregion effects


    // #region render
    return (
        <StyledPDF
            theme={theme}
            show={renderComplete}
            inversion={inversion}
        >
            <Document
                file={file}
                onLoadSuccess={onDocumentLoadSuccess}
                loading={(
                    <PluridSpinner
                        theme={theme}
                    />
                )}
            >
                {allRenderPages.map(page => {
                    if (!numPages) {
                        return;
                    }

                    if (page > numPages) {
                        return;
                    }

                    if (!renderPages.includes(page)) {
                        return (
                            <StyledUnrenderedPageContainer
                                key={`unrendered-${page}`}
                            >
                                <StyledUnrenderedPage
                                    inversion={inversion}
                                />
                            </StyledUnrenderedPageContainer>
                        );
                    }

                    return (
                        <Page
                            key={`rendered-${page}`}
                            pageNumber={page}
                            className={`pdf-page-${page}`}
                            // onRenderSuccess={() => onRenderSuccess(page)}
                        />
                    );
                })}
            </Document>
        </StyledPDF>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default PDF;
// #endregion exports
