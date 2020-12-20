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
    import AifSoundStrategy from './strategies/Mp3SoundStrategy';
    import CdaSoundStrategy from './strategies/Mp3SoundStrategy';
    import MidiSoundStrategy from './strategies/Mp3SoundStrategy';
    import Mp3SoundStrategy from './strategies/Mp3SoundStrategy';
    import MpaSoundStrategy from './strategies/Mp3SoundStrategy';
    import OggSoundStrategy from './strategies/Mp3SoundStrategy';
    import WavSoundStrategy from './strategies/Mp3SoundStrategy';
    import WmaSoundStrategy from './strategies/Mp3SoundStrategy';
    import WplSoundStrategy from './strategies/Mp3SoundStrategy';
    import EaudSoundStrategy from './strategies/Mp3SoundStrategy';
    // #endregion internal
// #endregion imports



// #region module
class SoundStrategy implements Strategy {
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
        const kind = 'sound';
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
            '.aif': AifSoundStrategy,
            '.cda': CdaSoundStrategy,
            '.mid': MidiSoundStrategy,
            '.midi': MidiSoundStrategy,
            '.mp3': Mp3SoundStrategy,
            '.mpa': MpaSoundStrategy,
            '.ogg': OggSoundStrategy,
            '.wav': WavSoundStrategy,
            '.wma': WmaSoundStrategy,
            '.wpl': WplSoundStrategy,
            '.eaud': EaudSoundStrategy,
        };
        const Strategy = strategies[this.extension];

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
export default SoundStrategy;
// #endregion external
