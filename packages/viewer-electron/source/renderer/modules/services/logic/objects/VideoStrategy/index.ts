// #region imports
    // #region libraries
    import {
        uuid,
    } from '@plurid/plurid-functions';
    // #endregion libraries


    // #region external
    import {
        Plane,
        Strategy,
    } from '~renderer-data/interfaces';
    // #endregion external


    // #region internal
    import Threeg2VideoStrategy from './strategies/MovVideoStrategy';
    import ThreegpVideoStrategy from './strategies/MovVideoStrategy';
    import AviVideoStrategy from './strategies/MovVideoStrategy';
    import FlvVideoStrategy from './strategies/MovVideoStrategy';
    import H264VideoStrategy from './strategies/MovVideoStrategy';
    import M4vVideoStrategy from './strategies/MovVideoStrategy';
    import MkvVideoStrategy from './strategies/MovVideoStrategy';
    import MovVideoStrategy from './strategies/MovVideoStrategy';
    import Mp4VideoStrategy from './strategies/MovVideoStrategy';
    import MpegVideoStrategy from './strategies/MovVideoStrategy';
    import RmVideoStrategy from './strategies/MovVideoStrategy';
    import SwfVideoStrategy from './strategies/MovVideoStrategy';
    import VobVideoStrategy from './strategies/MovVideoStrategy';
    import WmvVideoStrategy from './strategies/MovVideoStrategy';
    import EvidVideoStrategy from './strategies/MovVideoStrategy';
    // #endregion internal
// #endregion imports



// #region module
class VideoStrategy implements Strategy {
    private extension: string;
    private file: string;


    constructor(
        extension: string,
        file: string,
    ) {
        this.extension = extension;
        this.file = file;
    }


    public async compute() {
        const id = uuid.generate();
        const kind = 'video';
        const data = await this.strategy();

        if (!data) {
            return;
        }

        const plane: Plane = {
            id,
            kind,
            data,
        };

        return plane;
    }

    private async strategy() {
        const strategies = {
            '.3g2': Threeg2VideoStrategy,
            '.3gp': ThreegpVideoStrategy,
            '.avi': AviVideoStrategy,
            '.flv': FlvVideoStrategy,
            '.h264': H264VideoStrategy,
            '.m4v': M4vVideoStrategy,
            '.mkv': MkvVideoStrategy,
            '.mov': MovVideoStrategy,
            '.mp4': Mp4VideoStrategy,
            '.mpg': MpegVideoStrategy,
            '.mpeg': MpegVideoStrategy,
            '.rm': RmVideoStrategy,
            '.swf': SwfVideoStrategy,
            '.vob': VobVideoStrategy,
            '.wmv': WmvVideoStrategy,
            '.evid': EvidVideoStrategy,
        };
        const Strategy = (strategies as any)[this.extension];

        if (!Strategy) {
            return;
        }

        const strategy = new Strategy(
            this.file,
        );
        const data = await strategy.compute();

        return data;
    }
}
// #endregion module



// #region external
export default VideoStrategy;
// #endregion external
