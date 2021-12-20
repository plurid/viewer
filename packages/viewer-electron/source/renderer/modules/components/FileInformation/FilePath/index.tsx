// #region imports
    // #region libraries
    import React from 'react';
    // #endregion libraries


    // #region external
    import {
        PluridFormline,
        PluridScrollableLine,
    } from '~renderer-services/styled';
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


    // #region render
    return (
        <PluridFormline
            text="Filepath"
        >
            <div
                style={{
                    width: '165px',
                }}
            >
                <PluridScrollableLine
                    text={filepath}
                />
            </div>
        </PluridFormline>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default FileSize;
// #endregion exports
