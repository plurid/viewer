// #region imports
    // #region libraries
    import {
        Server,
    } from 'http';

    import express, {
        Application,
    } from 'express';

    import mime from 'mime-types';
    // #endregion libraries


    // #region internal
    import {
        sendFile,
    } from './logic';

    import {
        indexPage,
        notAvailablePage,
        errorPage,
    } from './templates';
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
                response.status(404).send(notAvailablePage);
                return;
            }

            const mimetype = mime.lookup(filepath);
            if (!mimetype) {
                response.status(500).send(errorPage);
                return;
            }

            // const streamAs = 'video/mp4';
            // console.log(`streaming file ${fileURL} from ${filepath} with mime ${mimetype}`);

            sendFile(
                request,
                response,
                filepath,
                mimetype,
            );
        });

        this.application.get('/', (_request, response) => {
            response.send(indexPage);
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
