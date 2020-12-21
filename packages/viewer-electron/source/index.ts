// #region imports
    // #region libraries
    import path from 'path';

    import {
        app as application,
        BrowserWindow,
    } from 'electron';
    // #endregion libraries


    // #region internal
    import setMenu from './menu';

    import {
        loadDatabase,
    } from './database';
    // #endregion internal
// #endregion imports



// #region module
// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let window: BrowserWindow | null;

(global as any).loadDatabase = loadDatabase;



const createWindow = () => {
    // Create the browser window.
    window = new BrowserWindow({
        width: 1000,
        height: 800,
        icon: './assets/meta/viewer.png',
        minHeight: 500,
        minWidth: 300,
        title: 'viewer',
        titleBarStyle: 'hiddenInset',
        webPreferences: {
            enableRemoteModule: true,
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false,
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

    // Open the DevTools.
    // window.webContents.openDevTools();

    // Handle load and show without flickering.
    window.maximize();

    window.webContents.on('did-finish-load', () => {
        if (window) {
            window.show();
        }
    });

    // Emitted when the window is closed.
    window.on('closed', () => {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        window = null;
    });
}


// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
application.on('ready', createWindow);



// Setup Menu.
application.whenReady().then(() => {
    setMenu(window);
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
// #endregion module
