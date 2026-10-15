// #region imports
    // #region libraries
    import path from 'path';
    // #endregion libraries


    // #region external
    import {
        imageExtensions,
        videoExtensions,
        soundExtensions,
        textExtensions,
    } from '~renderer-data/constants/defaults';
    // #endregion external
// #endregion imports



// #region module
const getFileType = (
    filepath: string,
) => {
    const extension = path.extname(filepath).toLowerCase();

    if (imageExtensions.includes(extension)) {
        return {
            kind: 'image',
            extension,
        };
    }

    if (videoExtensions.includes(extension)) {
        return {
            kind: 'video',
            extension,
        };
    }

    if (soundExtensions.includes(extension)) {
        return {
            kind: 'sound',
            extension,
        };
    }

    if (textExtensions.includes(extension)) {
        return {
            kind: 'text',
            extension,
        };
    }

    return {
        kind: 'unknown',
        extension,
    };
}
// #endregion module



// #region exports
export {
    getFileType,
};
// #endregion exports
