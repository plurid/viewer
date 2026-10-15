// #region imports
    // #region libraries
    import {
        loadEnhancedImage,
    } from '@plurid/enhanced-image-in-out';
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

            const blob = new Blob(
                [image],
                {
                    type: 'image/' + (header.type || 'png'),
                },
            );
            const url = URL.createObjectURL(
                blob,
            );

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
