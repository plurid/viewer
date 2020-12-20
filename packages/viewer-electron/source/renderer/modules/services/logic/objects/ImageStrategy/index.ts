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
    import BmpImageStrategy from './strategies/PngImageStrategy';
    import GifImageStrategy from './strategies/PngImageStrategy';
    import IcoImageStrategy from './strategies/PngImageStrategy';
    import JpegImageStrategy from './strategies/PngImageStrategy';
    import PngImageStrategy from './strategies/PngImageStrategy';
    import PsImageStrategy from './strategies/PngImageStrategy';
    import PsdImageStrategy from './strategies/PngImageStrategy';
    import SvgImageStrategy from './strategies/PngImageStrategy';
    import TiffImageStrategy from './strategies/PngImageStrategy';
    import WebpImageStrategy from './strategies/PngImageStrategy';
    import EimgImageStrategy from './strategies/PngImageStrategy';
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
