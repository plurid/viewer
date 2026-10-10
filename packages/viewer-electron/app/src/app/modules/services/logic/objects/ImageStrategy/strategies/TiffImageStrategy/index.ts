// #region imports
    // #region libraries
    import {
        promises as fs,
    } from 'fs';

    import UTIF from 'utif';
    // #endregion libraries
// #endregion imports



// #region module
const getUrlFromTiff = async (
    filepath: string,
) => {
    const buff = await fs.readFile(filepath);
    const ifds = UTIF.decode(buff);

    let vsns = ifds;
    let ma=0;
    let page=vsns[0];

    if (ifds[0].subIFD) {
        vsns = vsns.concat((ifds[0] as any).subIFD);
    }

    for (let i = 0; i < vsns.length; i++) {
        let img: any = vsns[i];

        if (img["t258"] == null || img["t258"].length < 3) {
            continue;
        }

        const ar = img["t256"] * img["t257"];

        if (ar > ma) {
            ma=ar;
            page=img;
        }
    }

    (UTIF as any).decodeImage(buff, page, ifds);

    const rgba = UTIF.toRGBA8(page);
    const w = page.width;
    const h = page.height;

    const cnv = document.createElement("canvas");
    cnv.width = w;
    cnv.height = h;

    const ctx = cnv.getContext("2d");
    if (!ctx) {
        return;
    }

    const imgd = new ImageData(
        new Uint8ClampedArray(rgba.buffer),
        w,
        h,
    );

    ctx.putImageData(imgd, 0, 0);
    const url = cnv.toDataURL();

    return url;
}


class TiffImageStrategy {
    private file: string;


    constructor(
        file: string,
    ) {
        this.file = file;
    }


    public async compute() {
        try {
            const url = await getUrlFromTiff(this.file);

            return {
                source: url,
            };
        } catch (error) {
            return;
        }
    }
}
// #endregion module



// #region external
export default TiffImageStrategy;
// #endregion external
