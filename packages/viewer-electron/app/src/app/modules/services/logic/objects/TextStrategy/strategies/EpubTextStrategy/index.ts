// #region imports
    // #region external
    import {
    } from '~renderer-data/interfaces';
    // #endregion external
// #endregion imports



// #region module
class EpubTextStrategy {
    private file: string;


    constructor(
        file: string,
    ) {
        this.file = file;
    }


    public async compute() {
        return {
            source: this.file,
            type: '.epub',
        };
    }
}
// #endregion module



// #region external
export default EpubTextStrategy;
// #endregion external
