/** Help → Show Crash Reports reveals the local Crashpad folder, and says so when it holds none. */
import type { MenuItemConstructorOptions } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installApplicationMenu } from '../src/desktop/windows/application-menu';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const native = vi.hoisted(() => ({
  buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => template),
  crashDumps: '',
  openPath: vi.fn(async () => ''),
  showMessageBox: vi.fn(async () => ({ response: 0 })),
}));
vi.mock('electron', () => ({
  Menu: { buildFromTemplate: native.buildFromTemplate, setApplicationMenu: vi.fn() },
  app: { isPackaged: true, getPath: () => native.crashDumps, getVersion: () => '1.0.0' },
  shell: { openPath: native.openPath, showItemInFolder: vi.fn(), openExternal: vi.fn() },
  dialog: { showMessageBox: native.showMessageBox },
}));

let root: string;
beforeEach(async () => {
  root = await temporaryRoot('viewer-crash-reports-');
  native.crashDumps = path.join(root, 'Crashpad');
  native.openPath.mockClear();
  native.showMessageBox.mockClear();
});
afterEach(async () => {
  await trashTemporary(root);
});

function showCrashReports(): () => void {
  installApplicationMenu(undefined, () => () => {}, path.join(root, 'diagnostics.log'), vi.fn());
  const template = native.buildFromTemplate.mock.calls.at(-1)![0];
  const help = template.find((item) => item.role === 'help')!
    .submenu as MenuItemConstructorOptions[];
  return help.find((item) => item.label === 'Show Crash Reports')!.click as () => void;
}

it('opens the Crashpad folder once it holds a report', async () => {
  await mkdir(path.join(native.crashDumps, 'completed'), { recursive: true });
  showCrashReports()();
  expect(native.openPath).not.toHaveBeenCalled();
  expect(native.showMessageBox).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'No crash reports have been recorded.' }),
  );
  await writeFile(path.join(native.crashDumps, 'completed', 'report.dmp'), 'dump', { flag: 'wx' });
  showCrashReports()();
  expect(native.openPath).toHaveBeenCalledWith(native.crashDumps);
});
