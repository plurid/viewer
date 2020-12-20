// #region imports
    // #region libraries
    import {
        uuid,
    } from '@plurid/plurid-functions';

    import {
        notifications,
    } from '@plurid/plurid-ui-state-react';
    // #endregion libraries


    // #region external
    import {
        Plane,
        Strategy as IStrategy,
    } from '~renderer-data/interfaces';

    import ImageStrategy from '~renderer-services/logic/objects/ImageStrategy';
    import VideoStrategy from '~renderer-services/logic/objects/VideoStrategy';
    import SoundStrategy from '~renderer-services/logic/objects/SoundStrategy';
    import TextStrategy from '~renderer-services/logic/objects/TextStrategy';
    import UnknownStrategy from '~renderer-services/logic/objects/UnknownStrategy';
    // #endregion external
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


    public async apply() {
        const plane = await this.strategy();
        const notification = this.notification(plane);

        return {
            plane,
            notification,
        };
    }


    private async strategy() {
        const strategies = {
            image: ImageStrategy,
            video: VideoStrategy,
            sound: SoundStrategy,
            text: TextStrategy,
            unknown: UnknownStrategy,
        };
        const Strategy = strategies[this.kind];

        if (!Strategy) {
            return;
        }

        const strategy = new Strategy(
            this.extension,
            this.file,
        );
        const plane = await strategy.compute();

        return plane;
    }

    private notification(
        plane: Plane | undefined,
    ) {
        const id = uuid.generate();
        const timeout = 4500;
        let text = '';

        if (!plane) {
            text = `Could not access ${this.kind}: '${this.file}'`;
        } else {
            text = `Opened ${this.kind}: '${this.file}'`;
        }

        const notification: notifications.Types.Notification = {
            id,
            text,
            timeout,
        };

        return notification;
    }
}
// #endregion module



// #region exports
export default FileStrategy;
// #endregion exports
