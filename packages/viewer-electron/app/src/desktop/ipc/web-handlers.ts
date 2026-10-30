import type { ApiHandlers } from './schemas';
import type { Resources } from '../previews/resources';
import type { WebPreviews } from '../previews/web/service';
import type { JournalActivity } from '../journal/activity';
import type { FileServices } from '../files/file-services';
import { savedPageFormats } from '../../domain/previews/saved-page';

type WebHandlers = Pick<
  ApiHandlers,
  | 'htmlPreview'
  | 'htmlPreviewClose'
  | 'localServerStart'
  | 'localServers'
  | 'localServerInspect'
  | 'localServerAction'
>;

interface WebPorts {
  activity?: Pick<JournalActivity, 'run' | 'at'>;
  previews: Pick<
    WebPreviews,
    | 'openHtml'
    | 'openPage'
    | 'closeHtml'
    | 'start'
    | 'list'
    | 'inspect'
    | 'stop'
    | 'restart'
    | 'clearLog'
    | 'dispose'
    | 'get'
  >;
  resources: Pick<Resources, 'editableFile' | 'documentFormat' | 'signal'>;
  files: Pick<FileServices, 'page'>;
  openURL(url: string): Promise<void>;
  copyURL(url: string): Promise<void>;
}

/** Pages receive scoped content; external browser and clipboard actions accept only owned IDs. */
export function createWebHandlers(ports: WebPorts): WebHandlers {
  const observe = <T>(
    action: 'start' | 'stop' | 'restart' | 'close',
    work: () => Promise<T>,
    paneID?: string,
  ) =>
    ports.activity
      ? ports.activity.at(paneID ? { planeID: paneID } : {}, () =>
          ports.activity!.run('server', action, work),
        )
      : work();
  return {
    htmlPreview: async ([resourceID, message], owner) => {
      const file = ports.resources.editableFile(resourceID);
      const format = await ports.resources.documentFormat(resourceID);
      // an email or web archive is a page made of the file's own parts, read in the preview worker
      const preview = savedPageFormats.includes(format)
        ? await ports.previews.openPage(owner, file, resourceID, (signal) =>
            ports.files.page(
              file,
              format,
              message,
              AbortSignal.any([signal, ports.resources.signal(resourceID)]),
            ),
          )
        : await ports.previews.openHtml(owner, file, resourceID);
      try {
        if (ports.resources.editableFile(resourceID) !== file)
          throw new Error('This HTML preview resource has changed. Open it again.');
      } catch (error) {
        await ports.previews.closeHtml(owner, preview.id);
        throw error;
      }
      return preview;
    },
    htmlPreviewClose: ([id], owner) => ports.previews.closeHtml(owner, id),
    localServerStart: ([root, paneID, identity], owner) =>
      observe('start', () => ports.previews.start(owner, root, paneID, identity), paneID),
    localServers: (_args, owner) => ports.previews.list(owner),
    localServerInspect: ([id], owner) => ports.previews.inspect(owner, id),
    localServerAction: async ([id, action], owner) => {
      switch (action) {
        case 'stop':
          await observe(
            'stop',
            () => ports.previews.stop(owner, id),
            ports.previews.get(owner, id).paneID,
          );
          return;
        case 'restart':
          await observe(
            'restart',
            () => ports.previews.restart(owner, id),
            ports.previews.get(owner, id).paneID,
          );
          return;
        case 'clear-log':
          ports.previews.clearLog(owner, id);
          return;
        case 'close':
          await observe(
            'close',
            () => ports.previews.dispose(owner, id),
            ports.previews.get(owner, id).paneID,
          );
          return;
        case 'open-browser':
        case 'copy-url': {
          const server = ports.previews.get(owner, id);
          if (server.state !== 'running') throw new Error('Start the local server first.');
          if (action === 'open-browser') await ports.openURL(server.url);
          else await ports.copyURL(server.url);
          return;
        }
        default: {
          const unhandled: never = action;
          throw new Error(`Unknown local server action: ${unhandled}`);
        }
      }
    },
  };
}
