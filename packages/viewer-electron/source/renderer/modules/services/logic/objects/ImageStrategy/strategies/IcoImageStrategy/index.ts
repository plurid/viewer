// #region imports
    // #region external
    import {
    } from '~renderer-data/interfaces';
    // #endregion external
// #endregion imports



// #region module
class IcoImageStrategy {
    private file: string;


    constructor(
        file: string,
    ) {
        this.file = file;
    }


    public async compute() {
        return {
            source: this.file,
        };
    }
}
// #endregion module



// #region external
export default IcoImageStrategy;
// #endregion external
