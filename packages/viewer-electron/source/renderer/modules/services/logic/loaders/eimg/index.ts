// #region imports
    // #region libraries
    import {
        Reader,
    } from '@plurid/enhanced-image-io';
    // #endregion libraries
// #endregion imports



// #region module
const eimgLoad = async (
    filepath: string,
) =>  {
    const reader = new Reader(filepath);
    const data = await reader.read();

    return data;
}
// #endregion module



// #region exports
export default eimgLoad;
// #endregion exports
