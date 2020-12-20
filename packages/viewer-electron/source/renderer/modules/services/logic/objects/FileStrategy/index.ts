// #region imports
    // #region libraries
    import {
        uuid,
    } from '@plurid/plurid-functions';

    import {
        notifications,
    } from '@plurid/plurid-ui-state-react';
    // #endregion libraries
// #endregion imports



// #region module
class FileStrategy {
    private kind: string;
    private extension: string;
    private file: string;

    constructor(
        kind: string,
        extension: string,
        file: string,
    ) {
        this.kind = kind;
        this.extension = extension;
        this.file = file;
    }


    public apply() {
        const plane = {
            id: uuid.generate(),
            kind: this.kind,
            data: {
                source: this.file,
            },
        };

        const notification: notifications.Types.Notification = {
            id: uuid.generate(),
            text: `Opened file '${this.kind}': '${this.file}'`,
            timeout: 4500,
        };

        return {
            plane,
            notification,
        };
    }
}
// #endregion module



// #region exports
export default FileStrategy;
// #endregion exports
