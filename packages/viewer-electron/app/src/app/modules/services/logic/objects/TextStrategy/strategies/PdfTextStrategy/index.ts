// #region imports
    // #region external
    import {
    } from '~renderer-data/interfaces';
    // #endregion external
// #endregion imports



// #region module
class PdfTextStrategy {
    private file: string;


    constructor(
        file: string,
    ) {
        this.file = file;
    }


    public async compute() {
        return {
            source: this.file,
            type: '.pdf',
        };
    }
}
// #endregion module



// #region external
export default PdfTextStrategy;
// #endregion external
