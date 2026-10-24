import type { ApiHandlers } from './schemas';
import type { Resources } from '../previews/resources';
import type { WebPreviews } from '../previews/web/service';

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
  previews: Pick<
    WebPreviews,
    | 'openHtml'
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
  resources: Pick<Resources, 'editableFile'>;
  openURL(url: string): Promise<void>;
  copyURL(url: string): Promise<void>;
}

/** Pages receive scoped content; external browser and clipboard actions accept only owned IDs. */
export function createWebHandlers(ports: WebPorts): WebHandlers {
  return {
    htmlPreview: async ([resourceID], owner) => {
      const file = ports.resources.editableFile(resourceID);
      const preview = await ports.previews.openHtml(owner, file, resourceID);
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
      ports.previews.start(owner, root, paneID, identity),
    localServers: (_args, owner) => ports.previews.list(owner),
    localServerInspect: ([id], owner) => ports.previews.inspect(owner, id),
    localServerAction: async ([id, action], owner) => {
      switch (action) {
        case 'stop':
          await ports.previews.stop(owner, id);
          return;
        case 'restart':
          await ports.previews.restart(owner, id);
          return;
        case 'clear-log':
          ports.previews.clearLog(owner, id);
          return;
        case 'close':
          await ports.previews.dispose(owner, id);
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
