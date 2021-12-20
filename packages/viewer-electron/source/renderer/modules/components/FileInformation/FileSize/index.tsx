// #region imports
    // #region libraries
    import React from 'react';
    // #endregion libraries


    // #region external
    import {
        PluridFormline,
    } from '~renderer-services/styled';

    import {
        useSize,
    } from '~renderer-services/hooks/file';
    // #endregion external
// #region imports



// #region module
export interface FileSizeProperties {
    // #region required
        // #region values
        filepath: string;
        // #endregion values

        // #region methods
        // #endregion methods
    // #endregion required
}

const FileSize: React.FC<FileSizeProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region required
            // #region values
            filepath,
            // #endregion values

            // #region methods
            // #endregion methods
        // #endregion required
    } = properties;
    // #endregion properties


    // #region effects
    const {
        loadedFileSize,
        fileSizeReadable,
    } = useSize(filepath);
    // #endregion effects


    // #region render
    if (!loadedFileSize) {
        return (<></>);
    }

    return (
        <PluridFormline
            text="Size"
        >
            {fileSizeReadable}
        </PluridFormline>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default FileSize;
// #endregion exports
