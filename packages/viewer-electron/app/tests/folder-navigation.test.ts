import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry } from '../src/domain/contracts';
import { openWorkspacePath } from '../src/renderer/workspace/open-path';
import {
  activeWorkspace,
  flushState,
  getState,
  initialize,
  navigate,
  newWorkspace,
  removePanes,
} from '../src/renderer/state/store';

const denied = () =>
  Object.assign(new Error('Folder access required'), { code: 'FILE_ACCESS_REQUIRED' });
const folder = (path: string): FileEntry => ({
  path,
  parent: '/',
  name: path.split('/').pop()!,
  directory: true,
  kind: 'directory',
  extension: '',
  mime: '',
  size: 0,
  created: 0,
  modified: 0,
  hidden: false,
  identity: path,
});
const stat = vi.fn(),
  chooseFolder = vi.fn(),
  dispatchEvent = vi.fn();
const controller = { open: vi.fn(), focusPane: vi.fn() };
const target = () => ({
  paneID: getState().activePane,
  workspaceID: activeWorkspace().id,
  directory: true,
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  stat.mockReset();
  chooseFolder.mockReset();
  vi.stubGlobal('window', {
    dispatchEvent,
    viewer: { stat, chooseFolder, save: vi.fn(async () => {}) },
  });
  initialize({ home: '/home', platform: 'darwin', locations: [], state: null, openPaths: [] });
});
afterEach(async () => {
  await flushState(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('native folder navigation recovery', () => {
  it('requests access for Volumes and opens the actual folder selected by the user', async () => {
    stat.mockRejectedValueOnce(denied()).mockResolvedValueOnce(folder('/Volumes/Work'));
    chooseFolder.mockResolvedValue('/Volumes/Work');
    const destination = target();
    await openWorkspacePath('/Volumes', destination, controller);
    expect(chooseFolder).toHaveBeenCalledExactlyOnceWith('/Volumes');
    expect(stat.mock.calls).toEqual([['/Volumes'], ['/Volumes/Work']]);
    expect(activeWorkspace().panes[0].path).toBe('/Volumes/Work');
    expect(controller.focusPane).toHaveBeenCalledWith(destination.paneID);
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'viewer:refresh' }));
  });
  it('uses existing access without a picker and retains linked/root plane behavior', async () => {
    stat.mockResolvedValue(folder('/Volumes'));
    const destination = target();
    await openWorkspacePath('/Volumes', { ...destination, linked: true }, controller);
    expect(controller.open).toHaveBeenCalledWith(folder('/Volumes'), destination.paneID, {
      another: undefined,
      link: undefined,
    });
    await openWorkspacePath('/Volumes', { ...destination, another: true }, controller);
    expect(controller.open).toHaveBeenLastCalledWith(folder('/Volumes'), destination.paneID, {
      another: true,
      link: undefined,
    });
    await openWorkspacePath('/Volumes', destination, controller);
    expect(activeWorkspace().panes[0].path).toBe('/Volumes');
    expect(chooseFolder).not.toHaveBeenCalled();
  });
  it('leaves the current folder unchanged when the user cancels', async () => {
    stat.mockRejectedValue(denied());
    chooseFolder.mockResolvedValue(null);
    await openWorkspacePath('/Volumes', target(), controller);
    expect(activeWorkspace().panes[0].path).toBe('/home');
    expect(controller.focusPane).not.toHaveBeenCalled();
    expect(controller.open).not.toHaveBeenCalled();
  });
  it('does not reinterpret denied files or missing paths as a folder request', async () => {
    stat.mockRejectedValue(denied());
    await expect(
      openWorkspacePath('/outside/file.txt', undefined, controller),
    ).rejects.toMatchObject({ code: 'FILE_ACCESS_REQUIRED' });
    stat.mockRejectedValue(Object.assign(new Error('Missing'), { code: 'ENOENT' }));
    await expect(openWorkspacePath('/missing', target(), controller)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(chooseFolder).not.toHaveBeenCalled();
  });
  it.each(['workspace', 'closed', 'navigated'])(
    'ignores a native picker result after its origin is %s',
    async (change) => {
      stat.mockRejectedValue(denied());
      let finish!: (path: string) => void;
      chooseFolder.mockImplementation(
        () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      );
      const destination = target();
      const request = openWorkspacePath('/Volumes', destination, controller);
      await Promise.resolve();
      if (change === 'workspace') await newWorkspace('Another');
      else if (change === 'closed') removePanes([destination.paneID]);
      else navigate(destination.paneID, '/other');
      finish('/Volumes/Work');
      await request;
      expect(stat).toHaveBeenCalledTimes(1);
      expect(controller.focusPane).not.toHaveBeenCalled();
      expect(controller.open).not.toHaveBeenCalled();
    },
  );
  it('surfaces picker errors without changing the origin', async () => {
    stat.mockRejectedValue(denied());
    chooseFolder.mockRejectedValue(new Error('Picker failed'));
    await expect(openWorkspacePath('/Volumes', target(), controller)).rejects.toThrow(
      'Picker failed',
    );
    expect(activeWorkspace().panes[0].path).toBe('/home');
  });
});
