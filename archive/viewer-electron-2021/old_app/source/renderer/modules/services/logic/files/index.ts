// #region imports
    // #region libraries
    import path from 'path';

    import fsSync, {
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
        file => {
            return !(/(^|\/)\.[^\/\.]/g).test(file.name);
        },
    );
}


export const newFolder = async (
    directory: string,
) => {
    const baseNewDirectory = path.join(
        directory,
        'New Folder',
    );

    let newDirectory = baseNewDirectory;
    let index = 1;
    let created = false;

    while(!created) {
        if (!fsSync.existsSync(newDirectory)) {
            await fs.mkdir(newDirectory);
            created = true;
        } else {
            newDirectory = baseNewDirectory + ` (${index})`;
            index += 1;
        }
    }
}


export const newFile = async (
    directory: string,
) => {
    const baseNewFilepath = path.join(
        directory,
        'New File',
    );

    let newFilepath = baseNewFilepath;
    let index = 1;
    let created = false;

    while(!created) {
        if (!fsSync.existsSync(newFilepath)) {
            await fs.writeFile(newFilepath, '');
            created = true;
        } else {
            newFilepath = baseNewFilepath + ` (${index})`;
            index += 1;
        }
    }
}


export const deleteFile = async (
    filepath: string,
) => {
    await fs.rm(filepath);
}


export const deleteFolder = async (
    filepath: string,
) => {
    await fs.rm(filepath, { recursive: true });
}
// #endregion module
