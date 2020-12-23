// #region imports
    // #region libraries
    import React, {
        useEffect,
        useRef,
        useState,
    } from 'react';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #endregion libraries


    // #region internal
    import {
        StyledPDF,
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
    // #endregion properties


    // #region references
    const frameReference = useRef<HTMLIFrameElement | null>(null);
    // #endregion references


    // #region state
    const [
        inversion,
        setInversion,
    ] = useState(1);
    // #endregion state


    // #region effects
    useEffect(() => {
        // const cssLink = document.createElement('link');
        // cssLink.href = 'style.css';
        // cssLink.rel = 'stylesheet';
        // cssLink.type = 'text/css';
        // frames[`text-frame-${file}`].document.head.appendChild(cssLink);

        // const frm = frames[`text-frame-${file}`].document;
        // console.log('frm', frm);
        // var otherhead = frm.getElementsByTagName("head")[0];
        // var link = frm.createElement("link");
        // link.setAttribute("rel", "stylesheet");
        // link.setAttribute("type", "text/css");
        // link.setAttribute("href", "style.css");
        // otherhead.appendChild(link);

        // if (!frameReference.current) {
        //     return;
        // }

        // frameReference.current

        // var iframe = top.frames[name].document;
        // var css = '' +
        //         '<style type="text/css">' +
        //         'body{margin:0;padding:0;background:transparent}' +
        //         '</style>';
        // iframe.open();
        // iframe.write(css);
        // iframe.close();
    }, [])
    // #endregion effects


    // #region render
    return (
        <StyledPDF
            theme={theme}
            disabledPointer={false}
        >
            <iframe
                src={
                    'libraries/pdfjs/web/viewer.html?file=' + encodeURIComponent(file)
                }
                id={`text-frame-${file}`}
                ref={frameReference}
            />
        </StyledPDF>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default PDF;
// #endregion exports
