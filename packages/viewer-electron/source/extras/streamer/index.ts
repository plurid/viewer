// #region imports
    // #region libraries
    import {
        Server,
    } from 'http';

    import express, {
        Application,
    } from 'express';
    // #endregion libraries


    // #region internal
    import {
        streamVideo,
    } from './logic';
    // #endregion internal
// #endregion imports



// #region module
class Streamer {
    private application: Application | undefined;
    private server: Server | undefined;

    private filesURLs: Record<string, string | undefined> = {};


    public start(
        port: number = 9090,
    ) {
        this.application = express();

        this.application.get('/:fileURL', (
            request,
            response,
        ) => {
            const fileURL = request.params.fileURL;
            const filepath = this.filesURLs[fileURL];
            if (!filepath) {
                response.status(404).end();
                return;
            }

            console.log(`streaming file ${fileURL} from ${filepath}`);

            streamVideo(
                request,
                response,
                filepath,
                'video/mp4',
            );
        });

        this.server = this.application.listen(port, '0.0.0.0', () => {
            // console.log('streamer started');
        });
    }

    public stop() {
        if (this.server) {
            this.server.close(() => {
                this.server = undefined;
            });
        }

        this.application = undefined;
    }

    public add(
        url: string,
        file: string,
    ) {
        this.filesURLs[url] = file;
    }

    public remove(
        url: string,
    ) {
        this.filesURLs[url] = undefined;
    }
}

const streamer = new Streamer();
// #endregion module



// #region exports
export default streamer;
// #endregion exports
