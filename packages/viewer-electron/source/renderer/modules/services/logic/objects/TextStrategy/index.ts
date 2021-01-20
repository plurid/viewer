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
    // markup files
    import MdTextStrategy from './strategies/PdfTextStrategy';
    import PluridocTextStrategy from './strategies/PdfTextStrategy';

    // presentation files
    import KeyTextStrategy from './strategies/PdfTextStrategy';
    import OdpTextStrategy from './strategies/PdfTextStrategy';
    import PpsTextStrategy from './strategies/PdfTextStrategy';
    import PptTextStrategy from './strategies/PdfTextStrategy';
    import PptxTextStrategy from './strategies/PdfTextStrategy';

    // word processor files
    import DocTextStrategy from './strategies/PdfTextStrategy';
    import DocxTextStrategy from './strategies/PdfTextStrategy';
    import OdtTextStrategy from './strategies/PdfTextStrategy';
    import RtfTextStrategy from './strategies/PdfTextStrategy';
    import TexTextStrategy from './strategies/PdfTextStrategy';
    import TxtTextStrategy from './strategies/PdfTextStrategy';
    import WpdTextStrategy from './strategies/PdfTextStrategy';

    // spreadsheet files
    import OdsTextStrategy from './strategies/PdfTextStrategy';
    import XlsTextStrategy from './strategies/PdfTextStrategy';
    import XlsmTextStrategy from './strategies/PdfTextStrategy';
    import XlsxTextStrategy from './strategies/PdfTextStrategy';

    // reading files
    import DjvuTextStrategy from './strategies/DjvuTextStrategy';
    import EpubTextStrategy from './strategies/EpubTextStrategy';
    import PdfTextStrategy from './strategies/PdfTextStrategy';
    // #endregion internal
// #endregion imports



// #region module
class TextStrategy implements Strategy {
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
        const kind = 'text';
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
            // markup files
            '.md': MdTextStrategy,
            '.pluridoc': PluridocTextStrategy,

            // presentation files
            '.key': KeyTextStrategy,
            '.odp': OdpTextStrategy,
            '.pps': PpsTextStrategy,
            '.ppt': PptTextStrategy,
            '.pptx': PptxTextStrategy,

            // word processor files
            '.doc': DocTextStrategy,
            '.docx': DocxTextStrategy,
            '.odt': OdtTextStrategy,
            '.rtf': RtfTextStrategy,
            '.tex': TexTextStrategy,
            '.txt': TxtTextStrategy,
            '.wpd': WpdTextStrategy,

            // spreadsheet files
            '.ods': OdsTextStrategy,
            '.xls': XlsTextStrategy,
            '.xlsm': XlsmTextStrategy,
            '.xlsx': XlsxTextStrategy,

            // reading files
            '.epub': EpubTextStrategy,
            '.djvu': DjvuTextStrategy,
            '.pdf': PdfTextStrategy,
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
export default TextStrategy;
// #endregion external
