// #region imports
    // #region libraries
    import {
        loadEnhancedImage,
    } from '@plurid/enhanced-image-io';
    // #endregion libraries
// #endregion imports



// #region module
class EimgImageStrategy {
    private file: string;


    constructor(
        file: string,
    ) {
        this.file = file;
    }


    public async compute() {
        try {
            const data = await loadEnhancedImage(this.file);

            const {
                header,
                image,
            } = data;

            const blob = new Blob([image]);
            const url = URL.createObjectURL(blob);

            return {
                source: url,
                header,
            };
        } catch (error) {
            return;
        }
    }
}
// #endregion module



// #region external
export default EimgImageStrategy;
// #endregion external
