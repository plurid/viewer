// #region imports
    // #region libraries
    import React, {
        useState,
    } from 'react';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #endregion libraries


    // #region external
    import {
        PluridTextline,
    } from '~renderer-services/styled';
    // #endregion external


    // #region internal
    import {
        StyledDirectoryPath,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
export interface DirectoryPathProperties {
    // #region required
        // #region values
        theme: Theme;
        directory: string;
        // #endregion values

        // #region methods
        update: (directory: string) => void;
        // #endregion methods
    // #endregion required
}

const DirectoryPath: React.FC<DirectoryPathProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region required
            // #region values
            theme,
            directory,
            // #endregion values

            // #region methods
            update,
            // #endregion methods
        // #endregion required
    } = properties;
    // #endregion properties


    // #region state
    const [
        localDirectory,
        setLocalDirectory,
    ] = useState(directory);
    // #endregion state


    // #region render
    return (
        <StyledDirectoryPath
            theme={theme}
        >
            <PluridTextline
                text={localDirectory}
                atChange={(event) => {
                    setLocalDirectory(event.target.value);
                }}
                atKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        update(localDirectory);
                    }
                }}
                level={2}
            />
        </StyledDirectoryPath>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default DirectoryPath;
// #endregion exports
