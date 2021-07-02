// #region imports
    // #region libraries
    import path from 'path';

    import {
        app as application,
        BrowserWindow,
        globalShortcut,
    } from 'electron';

    import contextMenu from 'electron-context-menu';
    // #endregion libraries


    // #region internal
    import setMenu from './menu';

    import {
        loadDatabase,
    } from './database';

    import generateTouchBar from './extras/touchbar';

    import {
        handleURLNavigation,
        environment,
    } from './utilities';

    import debug from './utilities/debug';
    // #endregion internal
// #endregion imports



// #region module
const setShortcuts = () => {
    // // new space
    // globalShortcut.register('CommandOrControl+T', () => {
    //     console.log('CommandOrControl+T is pressed');
    // });

    // // close space
    // globalShortcut.register('CommandOrControl+W', () => {
    //     console.log('CommandOrControl+W is pressed');
    // });

    // // quit
    // globalShortcut.register('CommandOrControl+Q', () => {
    //     console.log('CommandOrControl+Q is pressed');
    // });
}


// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let window: BrowserWindow | null;

(global as any).loadDatabase = loadDatabase;



contextMenu({
    menu: (
        defaultActions,
        params,
        browserWindow,
    ) => [
        defaultActions.copy({}),
        defaultActions.paste({}),
    ],
});


const createWindow = () => {
    const isMac = process.platform === 'darwin';


    // Create the browser window.
    window = new BrowserWindow({
        width: 1000,
        height: 800,
        icon: './assets/meta/viewer.png',
        minHeight: 500,
        minWidth: 300,
        title: 'viewer',
        titleBarStyle: 'hiddenInset',
        // frame: false,
        webPreferences: {
            enableRemoteModule: true,
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: true,
        },
        show: false,
    });


    // and load the index.html of the app.
    const indexRender = path.join(
        __dirname,
        'index.html',
    );
    window.loadFile(
        indexRender,
    );

    if (!environment.production) {
        // Open the DevTools.
        window.webContents.openDevTools();
    }

    // Handle load and show without flickering.
    window.maximize();

    window.webContents.on('did-finish-load', () => {
        if (!window) {
            return;
        }

        window.show();
    });

    // Emitted when the window is closed.
    window.on('closed', () => {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        window = null;
    });

    const regenerate = () => {
        if (!window) {
            return;
        }

        window.setTouchBar(
            generateTouchBar(
                window,
                regenerate,
            )
        );
    }

    window.setTouchBar(
        generateTouchBar(
            window,
            regenerate,
        ),
    );

    window.webContents.on(
        'will-navigate',
        handleURLNavigation,
    );

    setMenu(
        window,
        createWindow,
    );

    window.webContents.setWindowOpenHandler(({ url }) => {
        require('electron').shell.openExternal(url);

        return { action: 'deny' };
    });
}


// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
application.on('ready', createWindow);



// Setup Menu.
application.whenReady().then(() => {
    setMenu(
        window,
        createWindow,
    );

    setShortcuts();
});


// Quit when all windows are closed.
application.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        application.quit();
    }
});


application.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (window === null) {
        createWindow();
    }
});


application.allowRendererProcessReuse = true;



application.on(
    'open-file',
    async (
        _,
        path,
    ) => {
        const files = [
            path,
        ];

        if (window) {
            window.webContents.send('FILES_OPEN', files);
            return;
        }

        if (!window) {
            application.on('ready', async () => {
                createWindow();

                await new Promise((resolve) => {
                    setTimeout(() => {
                        (window as BrowserWindow).webContents.send('FILES_OPEN', [path]);
                        resolve(true);
                    }, 3_000);
                });
            });
        }
    }
);



application.on('will-quit', () => {
    globalShortcut.unregisterAll();
})
// #endregion module
