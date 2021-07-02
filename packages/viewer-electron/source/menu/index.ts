// #region imports
    // #region libraries
    import path from 'path';

    import {
        app,
        dialog,
        Menu,
        MenuItem,
        MenuItemConstructorOptions,

        BrowserWindow,
    } from 'electron';
    // #endregion libraries
// #endregion imports



// #region module
const setMenu = (
    window: BrowserWindow | null,
    createWindow: () => void,
) => {
    const isMac = process.platform === 'darwin';
    let lastOpenPath = '';

    const appMenu: any = isMac
        ? [
            {
                label: app.name,
                submenu: [
                    { role: 'about' },
                    { type: 'separator' },
                    { role: 'services' },
                    { type: 'separator' },
                    { role: 'hide' },
                    { role: 'hideothers' },
                    { role: 'unhide' },
                    { type: 'separator' },
                    { role: 'quit' },
                ],
            }
        ] : [];

    const editMenuEnding: any = isMac
        ? [
            { role: 'pasteAndMatchStyle' },
            { role: 'delete' },
            { role: 'selectAll' },
            { type: 'separator' },
            {
                label: 'Speech',
                submenu: [
                    { role: 'startSpeaking' },
                    { role: 'stopSpeaking' },
                ],
            },
        ] : [
            { role: 'delete' },
            { type: 'separator' },
            { role: 'selectAll' },
        ];

    const windowMenuEnding = isMac
        ? [
            { type: 'separator' },
            { role: 'front' },
            { type: 'separator' },
            { role: 'window' },
        ] : [
            { role: 'close' },
        ];


    const template: (MenuItem | MenuItemConstructorOptions)[] = [
        // { role: 'appMenu' }
        ...appMenu,

        // { role: 'fileMenu' }
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Window',
                    accelerator: 'Shift+CmdOrCtrl+N',
                    click: async () => {
                        if (!window) {
                            createWindow();
                        }
                    },
                    enabled: !window,
                },
                {
                    label: 'New Space',
                    accelerator: 'CommandOrControl+T',
                    click: async () => {

                    },
                },
                {
                    label: 'Restore Space',
                    accelerator: 'Shift+CommandOrControl+T',
                    click: async () => {

                    },
                },
                { type: 'separator' },
                {
                    label: 'Open...',
                    accelerator: 'CmdOrCtrl+O',
                    click: async () => {
                        try {
                            if (!window) {
                                createWindow();
                            }

                            const filesData = await dialog.showOpenDialog({
                                defaultPath: lastOpenPath,
                                properties: [
                                    'openFile',
                                    'multiSelections',
                                ],
                            });

                            const {
                                canceled,
                                filePaths,
                            } = filesData;

                            if (canceled) {
                                return;
                            }

                            if (!window) {
                                return;
                            }

                            lastOpenPath = path.dirname(filePaths[0]);

                            setTimeout(() => {
                                window.webContents.send('FILES_OPEN', filePaths);
                            }, 500);
                        } catch (error) {
                            console.log(error);
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Close Space',
                    accelerator: 'CommandOrControl+W',
                    click: async () => {

                    },
                },
                isMac ? { role: 'close' } : { role: 'quit' },
                isMac ? {
                    label: 'Quit',
                    accelerator: 'CommandOrControl+Q',
                    click: async () => {

                    },
                } : undefined,
            ],
        },

        // { role: 'editMenu' }
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                ...editMenuEnding,
            ]
        },

        // { role: 'viewMenu' }
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },

        // { role: 'windowMenu' }
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                { role: 'zoom' },
                ...windowMenuEnding,
            ],
        },
        {
            role: 'help',
            submenu: [
                {
                    label: 'Report an Issue',
                    click: async () => {
                        const { shell } = require('electron');

                        await shell.openExternal('https://support.plurid.com/viewer');
                    },
                },
                {
                    label: 'Plurid Viewer',
                    click: async () => {
                        const { shell } = require('electron');

                        await shell.openExternal('https://plurid.com/viewer');
                    },
                },
            ],
        },
    ];

    const menu = Menu.buildFromTemplate(template);

    Menu.setApplicationMenu(menu);
}
// #endregion module



// #region exports
export default setMenu;
// #endregion exports
