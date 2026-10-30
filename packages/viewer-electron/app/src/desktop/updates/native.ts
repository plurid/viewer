import { BrowserWindow, dialog, shell } from 'electron';
import path from 'node:path';
import { browserAddress } from '../../domain/previews/browser';
import { updateFeedConfiguration } from '../release';
import { installedRelease } from '../windows/about';
import { Updates } from './updates';
import type { UpdateNotice } from './updates';

async function presentNotice(notice: UpdateNotice): Promise<boolean> {
  const options = {
    type: 'info' as const,
    message: notice.message,
    detail: notice.detail,
    buttons: notice.download ? ['Download', 'Later'] : ['OK'],
    defaultId: 0,
    cancelId: notice.download ? 1 : 0,
  };
  const parent = BrowserWindow.getFocusedWindow();
  const { response } = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  return !!notice.download && response === 0;
}

/** The address check of a browser plane's external open, limited to https. */
async function openDownload(url: string): Promise<void> {
  const address = new URL(browserAddress(url));
  if (address.protocol !== 'https:')
    throw new Error('Viewer opens update downloads only from https addresses.');
  await shell.openExternal(address.href);
}

/** Updates for this copy of Viewer, with native dialogs; its record stays in `dataPath`. */
export function applicationUpdates(dataPath: string, checkAtLaunch: () => boolean): Updates {
  return new Updates(path.join(dataPath, 'updates-v1.json'), {
    configuration: updateFeedConfiguration,
    store: !!process.mas,
    installed: installedRelease(),
    systemVersion: () => process.getSystemVersion(),
    checkAtLaunch,
    present: presentNotice,
    open: openDownload,
  });
}
