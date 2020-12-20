// #region imports
    // #region libraries
    import {
        uuid,
    } from '@plurid/plurid-functions';
    // #endregion libraries


    // #region external
    import {
        Plane,
        Strategy,
    } from '~renderer-data/interfaces';
    // #endregion external


    // #region internal
    import AiImageStrategy from './strategies/PngImageStrategy';
    import BmpImageStrategy from './strategies/BmpImageStrategy';
    import GifImageStrategy from './strategies/GifImageStrategy';
    import IcoImageStrategy from './strategies/IcoImageStrategy';
    import JpegImageStrategy from './strategies/JpegImageStrategy';
    import PngImageStrategy from './strategies/PngImageStrategy';
    import PsImageStrategy from './strategies/PngImageStrategy';
    import PsdImageStrategy from './strategies/PngImageStrategy';
    import SvgImageStrategy from './strategies/SvgImageStrategy';
    import TiffImageStrategy from './strategies/TiffImageStrategy';
    import WebpImageStrategy from './strategies/WebpImageStrategy';
    import EimgImageStrategy from './strategies/EimgImageStrategy';
    // #endregion internal
// #endregion imports



// #region module
class ImageStrategy implements Strategy {
    private extension: string;
    private file: string;


    constructor(
        extension: string,
        file: string,
    ) {
        this.extension = extension;
        this.file = file;
    }


    public async compute() {
        const id = uuid.generate();
        const kind = 'image';
        const data = await this.strategy();

        if (!data) {
            return;
        }

        const plane: Plane = {
            id,
            kind,
            data,
        };

        return plane;
    }


    private async strategy() {
        const strategies = {
            '.ai': AiImageStrategy,
            '.bmp': BmpImageStrategy,
            '.gif': GifImageStrategy,
            '.ico': IcoImageStrategy,
            '.jpeg': JpegImageStrategy,
            '.jpg': JpegImageStrategy,
            '.png': PngImageStrategy,
            '.ps': PsImageStrategy,
            '.psd': PsdImageStrategy,
            '.svg': SvgImageStrategy,
            '.tif': TiffImageStrategy,
            '.tiff': TiffImageStrategy,
            '.webp': WebpImageStrategy,
            '.eimg': EimgImageStrategy,
        };
        const Strategy = strategies[this.extension];

        if (!Strategy) {
            return;
        }

        const strategy = new Strategy(
            this.file,
        );
        const data = await strategy.compute();

        return data;
    }
}
// #endregion module



// #region external
export default ImageStrategy;
// #endregion external
