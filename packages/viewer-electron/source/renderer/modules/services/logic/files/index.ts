// #region imports
    // #region libraries
    import {
        Dirent,
        promises as fs,
    } from 'fs';
    // #endregion libraries
// #endregion imports



// #region module
export const getDirectoryFiles = async (
    path: string,
) => {
    const files = await fs.readdir(
        path,
        {
            withFileTypes: true,
        },
    );
    return files;
}


export const ignoreHiddenFiles = (
    files: Dirent[],
) => {
    return files.filter(
        file => !(/(^|\/)\.[^\/\.]/g).test(file.name),
    );
}
// #endregion module
