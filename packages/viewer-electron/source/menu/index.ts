// #region imports
    // #region libraries
    import {
        app,
        dialog,
        Menu,
        MenuItem,
        MenuItemConstructorOptions,
    } from 'electron';
    // #endregion libraries
// #endregion imports



// #region module
const setMenu = () => {
    const isMac = process.platform === 'darwin'

    const template: (MenuItem | MenuItemConstructorOptions)[] = [
        // { role: 'appMenu' }
        // ...(isMac ? [{
        //     label: app.name,
        //     submenu: [
        //         { role: 'about' },
        //         { type: 'separator' },
        //         { role: 'services' },
        //         { type: 'separator' },
        //         { role: 'hide' },
        //         { role: 'hideothers' },
        //         { role: 'unhide' },
        //         { type: 'separator' },
        //         { role: 'quit' }
        //     ]
        // }] : []),

        // { role: 'fileMenu' }
        {
            label: 'File',
            submenu: [
                {
                    label: 'Open File...',
                    accelerator: 'CmdOrCtrl+O',
                    click: async () => {
                        const filesData = await dialog.showOpenDialog({
                            properties: [
                                'openFile',
                                'multiSelections',
                            ],
                        });

                        if (filesData.canceled) {
                            return;
                        }

                        console.log(filesData.filePaths);
                    }
                },
                { type: 'separator' },
                isMac ? { role: 'close' } : { role: 'quit' },
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
                // ...(isMac ? [
                //     { role: 'pasteAndMatchStyle' },
                //     { role: 'delete' },
                //     { role: 'selectAll' },
                //     { type: 'separator' },
                //     {
                //     label: 'Speech',
                //     submenu: [
                //         { role: 'startSpeaking' },
                //         { role: 'stopSpeaking' }
                //     ]
                //     }
                // ] : [
                //     { role: 'delete' },
                //     { type: 'separator' },
                //     { role: 'selectAll' }
                // ])
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
                // ...(isMac ? [
                //     { type: 'separator' },
                //     { role: 'front' },
                //     { type: 'separator' },
                //     { role: 'window' }
                // ] : [
                //     { role: 'close' }
                // ])
            ]
        },
        {
            role: 'help',
            submenu: [
                {
                    label: 'Learn More',
                    click: async () => {
                        const { shell } = require('electron');

                        await shell.openExternal('https://github.com/plurid/viewer');
                    }
                }
            ]
        },
    ];

    const menu = Menu.buildFromTemplate(template);

    Menu.setApplicationMenu(menu);
}
// #endregion module



// #region exports
export default setMenu;
// #endregion exports
