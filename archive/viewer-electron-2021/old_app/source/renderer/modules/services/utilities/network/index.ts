// #region imports
    // #region libraries
    import os from 'os';
    // #endregion libraries
// #endregion imports



// #region module
/**
 * https://stackoverflow.com/a/15075395/6639124
 *
 * @returns
 */
export const getLocalIPAddress = () => {
    const interfaces = os.networkInterfaces();

    for (const deviceName in interfaces) {
        const iface = interfaces[deviceName];
        if (!iface) {
            continue;
        }

        for (let i = 0; i < iface.length; i++) {
            const alias = iface[i];

            if (
                alias.family === 'IPv4'
                && alias.address !== '127.0.0.1'
                && !alias.internal
            ) {
                return alias.address;
            }
        }
    }

    return '0.0.0.0';
}
// #endregion module
