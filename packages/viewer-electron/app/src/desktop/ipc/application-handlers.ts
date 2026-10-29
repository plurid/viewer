import type { BrowserWindow } from 'electron';
import { isPackage } from '../../domain/files/entries';
import type { ApiHandlers } from './schemas';
import type { Applications } from '../native/applications';
import type { AppIcons } from '../native/app-icons';
import { entry } from '../files/filesystem';
import { chooseRemembered, type DialogAccess } from '../native/dialogs';

type ApplicationHandlers = Pick<
  ApiHandlers,
  'applications' | 'openWith' | 'applicationIcon' | 'chooseApplication' | 'appIcon'
>;
interface ApplicationPorts {
  applications: Pick<Applications, 'list' | 'open' | 'location' | 'register'>;
  icons: Pick<AppIcons, 'get'>;
  fileAccess: DialogAccess;
  requireWindow(owner: number): BrowserWindow;
}

/** The applications that open a window's files, and the icons drawn for them and for bundles. */
export function createApplicationHandlers(ports: ApplicationPorts): ApplicationHandlers {
  return {
    applications: async ([paths]) => {
      await ports.fileAccess.require(paths);
      return ports.applications.list(paths);
    },
    openWith: async ([paths, id]) => {
      await ports.fileAccess.require(paths);
      return ports.applications.open(paths, id);
    },
    // the path comes from Launch Services' own listing, never from the renderer
    applicationIcon: async ([id]) => {
      const item = await entry(ports.applications.location(id));
      return ports.icons.get(item.path, 'small', item.modified);
    },
    chooseApplication: async (_args, owner) => {
      if (process.platform !== 'darwin')
        throw new Error('Application selection is not available on this platform yet.');
      const application = await chooseRemembered(
        ports.fileAccess,
        ports.requireWindow(owner),
        {
          title: 'Choose Application',
          defaultPath: '/Applications',
          properties: ['openFile'],
          filters: [{ name: 'Applications', extensions: ['app'] }],
        },
        // a bundle is a folder
        true,
      );
      if (!application) return null;
      await ports.fileAccess.require([application]);
      return ports.applications.register(application);
    },
    appIcon: async ([file, size]) => {
      await ports.fileAccess.require([file]);
      const item = await entry(file);
      if (!isPackage(item))
        throw new Error('Icons are offered for applications and other bundles only.');
      const icon = await ports.icons.get(item.path, size, item.modified);
      await ports.fileAccess.require([file]);
      return icon;
    },
  };
}
