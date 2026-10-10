// #region imports
    // #region libraries
    import fs from 'fs';

    import {
        useState,
        useEffect,
    } from 'react';

    import {
        size,
    } from '@plurid/plurid-functions';
    // #endregion libraries
// #endregion imports



// #region module
export const useSize = (
    filepath: string,
) => {
    // #region state
    const [
        loadedFileSize,
        setLoadedFileSize,
    ] = useState(false);

    const [
        fileSize,
        setFileSize,
    ] = useState(0);
    // #endregion state


    // #region effects
    useEffect(() => {
        const getFileSize = async () => {
            try {
                const stats = fs.statSync(filepath);

                setFileSize(stats.size);
                setLoadedFileSize(true);
            } catch (error) {
                return;
            }
        }

        getFileSize();
    }, [
        filepath,
    ]);
    // #endregion effects


    return {
        loadedFileSize,
        fileSizeBytes: fileSize,
        fileSizeReadable: size.humanFormat(fileSize),
    };
}
// #endregion module
