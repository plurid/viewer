// #region imports
    // #region libraries
    import {
        loadEnhancedImage,
    } from '@plurid/enhanced-image-io';
    // #endregion libraries
// #endregion imports



// #region module
const eimgLoad = async (
    filepath: string,
) =>  {
    const data = await loadEnhancedImage(filepath);

    return data;
}
// #endregion module



// #region exports
export default eimgLoad;
// #endregion exports
