// @vitest-environment jsdom
import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FolderAccessButton,
  resetFolderAccessAttempts,
} from '../src/renderer/ui/permissions/FolderAccessButton';
import { chooseRemembered } from '../src/desktop/native/dialogs';
import {
  attachWindowDialogs,
  WindowDialogs,
  windowDialogs,
} from '../src/desktop/native/window-dialogs';
import {
  createAccessHandlers,
  openPrivacySettings,
  privacySettingsURLs,
} from '../src/desktop/ipc/access-handlers';
import { methodWindows, schemas } from '../src/desktop/ipc/schemas';
import { initialize } from '../src/renderer/state/workspaces';
import type { DesktopEvent } from '../src/domain/contracts';

const electronMock = vi.hoisted(() => ({
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openExternal: vi.fn(async () => {}) },
}));
vi.mock('electron', () => electronMock);

function stubWindow(id: number, onSend?: (event: DesktopEvent) => void) {
  const win = new EventEmitter() as unknown as BrowserWindow & EventEmitter;
  const wc = new EventEmitter() as EventEmitter & {
    id: number;
    isDestroyed: () => boolean;
    send: ReturnType<typeof vi.fn>;
  };
  wc.id = id;
  wc.isDestroyed = () => false;
  wc.send = vi.fn((_channel: string, event: DesktopEvent) => {
    onSend?.(event);
  });
  Object.assign(win, { webContents: wc, isDestroyed: () => false });
  return { win, wc };
}

describe('FolderAccessButton recovery paths', () => {
  const chooseFolder = vi.fn();
  const list = vi.fn();
  const fileAccessPrivacySettings = vi.fn();

  beforeEach(() => {
    chooseFolder.mockReset();
    list.mockReset();
    fileAccessPrivacySettings.mockReset();
    resetFolderAccessAttempts();
    initialize({ home: '/Users/alex', platform: 'darwin', state: null, locations: [], openPaths: [] });
    Object.assign(window, {
      viewer: {
        chooseFolder,
        list,
        fileAccessPrivacySettings,
        save: vi.fn(async () => {}),
      },
    });
  });

  afterEach(() => {
    cleanup();
    resetFolderAccessAttempts();
  });

  it('opens the native folder panel and completes when choosing the folder lifts the refusal', async () => {
    const onGranted = vi.fn();
    const refreshed = vi.fn();
    window.addEventListener('viewer:refresh', refreshed);
    chooseFolder.mockResolvedValue('/Users/alex/Documents');
    list.mockResolvedValue({ path: '/Users/alex/Documents', entries: [] });

    render(<FolderAccessButton folder="/Users/alex/Documents" onGranted={onGranted} />);
    fireEvent.click(screen.getByRole('button', { name: 'Allow Folder Access…' }));

    await waitFor(() => expect(onGranted).toHaveBeenCalledExactlyOnceWith('/Users/alex/Documents'));
    expect(chooseFolder).toHaveBeenCalledExactlyOnceWith('/Users/alex/Documents', true);
    expect(list).toHaveBeenCalledExactlyOnceWith('/Users/alex/Documents');
    expect(refreshed).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Open Privacy Settings…' })).toBeNull();
    window.removeEventListener('viewer:refresh', refreshed);
  });

  it('keeps Allow Folder Access and offers Open Privacy Settings with a reason when macOS still refuses the folder', async () => {
    const onGranted = vi.fn();
    chooseFolder.mockResolvedValue('/Users/alex/Documents');
    list.mockRejectedValue(Object.assign(new Error('Operation not permitted'), { code: 'EPERM' }));
    fileAccessPrivacySettings.mockResolvedValue(undefined);

    render(<FolderAccessButton folder="/Users/alex/Documents" onGranted={onGranted} />);
    fireEvent.click(screen.getByRole('button', { name: 'Allow Folder Access…' }));

    const privacyButton = await screen.findByRole('button', { name: 'Open Privacy Settings…' });
    expect(screen.getByRole('button', { name: 'Allow Folder Access…' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(
      'System Settings → Privacy & Security → Files & Folders',
    );
    expect(onGranted).not.toHaveBeenCalled();

    fireEvent.click(privacyButton);
    await waitFor(() => expect(fileAccessPrivacySettings).toHaveBeenCalledExactlyOnceWith('files'));
  });

  it('targets Full Disk Access when a Trash or protected Library folder remains refused', async () => {
    chooseFolder.mockResolvedValue('/Users/alex/Library/Mail');
    list.mockRejectedValue(Object.assign(new Error('Permission denied'), { code: 'EACCES' }));
    fileAccessPrivacySettings.mockResolvedValue(undefined);

    render(<FolderAccessButton folder="/Users/alex/Library/Mail" />);
    fireEvent.click(screen.getByRole('button', { name: 'Allow Folder Access…' }));

    const privacyButton = await screen.findByRole('button', { name: 'Open Privacy Settings…' });
    expect(screen.getByRole('status').textContent).toContain(
      'System Settings → Privacy & Security → Full Disk Access',
    );

    fireEvent.click(privacyButton);
    await waitFor(() =>
      expect(fileAccessPrivacySettings).toHaveBeenCalledExactlyOnceWith('all-files'),
    );
  });
});

describe('native folder panel and privacy settings desktop boundary', () => {
  beforeEach(() => {
    electronMock.dialog.showOpenDialog.mockReset();
    electronMock.shell.openExternal.mockReset();
  });

  it('uses the native macOS panel for permission recovery in the direct build while keeping ordinary picks in-window and Store bookmarks unchanged', async () => {
    const inWindowPrompts: string[] = [];
    const holder: { win?: BrowserWindow } = {};
    const { win } = stubWindow(11, (event) => {
      if (event.type === 'dialog' && event.prompt?.kind === 'file') {
        inWindowPrompts.push(event.prompt.id);
        void windowDialogs(holder.win!, false)?.request({
          kind: 'choose',
          id: event.prompt.id,
          paths: ['/Users/alex/Projects'],
        });
      }
    });
    holder.win = win;
    // Register a window dialog host as the direct build does for ordinary folder picks.
    const dialogs = new WindowDialogs({
      home: '/Users/alex',
      places: async () => [],
      access: async () => {},
      publish: (prompt) => {
        win.webContents.send('viewer:event', { type: 'dialog', prompt });
      },
    });
    attachWindowDialogs(win, dialogs);
    await dialogs.request({ kind: 'current' });

    const directAccess = {
      scoped: false,
      remember: vi.fn(async () => {}),
      allowOnce: vi.fn(async () => {}),
      require: vi.fn(async () => {}),
    };
    // Ordinary pick stays in Viewer's window dialog.
    const ordinary = await chooseRemembered(
      directAccess,
      win,
      { properties: ['openDirectory'], defaultPath: '/Users/alex' },
      true,
      false,
    );
    expect(ordinary).toBe('/Users/alex/Projects');
    expect(inWindowPrompts).toHaveLength(1);
    expect(electronMock.dialog.showOpenDialog).not.toHaveBeenCalled();

    // Permission recovery passes native=true and bypasses the in-window dialog.
    electronMock.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/Users/alex/Documents'],
    });
    const recovered = await chooseRemembered(
      directAccess,
      win,
      { properties: ['openDirectory'], defaultPath: '/Users/alex/Documents' },
      true,
      true,
    );
    expect(recovered).toBe('/Users/alex/Documents');
    expect(inWindowPrompts).toHaveLength(1);
    expect(electronMock.dialog.showOpenDialog).toHaveBeenCalledExactlyOnceWith(win, {
      properties: ['openDirectory'],
      defaultPath: '/Users/alex/Documents',
      securityScopedBookmarks: false,
    });

    // Store build keeps security-scoped bookmarks unchanged.
    const storeAccess = {
      scoped: true,
      remember: vi.fn(async () => {}),
      allowOnce: vi.fn(async () => {}),
      require: vi.fn(async () => {}),
    };
    electronMock.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/Users/alex/Documents'],
      bookmarks: ['store-bookmark-token'],
    });
    const storeChosen = await chooseRemembered(
      storeAccess,
      win,
      { properties: ['openDirectory'], defaultPath: '/Users/alex/Documents' },
      true,
      true,
    );
    expect(storeChosen).toBe('/Users/alex/Documents');
    expect(electronMock.dialog.showOpenDialog).toHaveBeenLastCalledWith(win, {
      properties: ['openDirectory'],
      defaultPath: '/Users/alex/Documents',
      securityScopedBookmarks: true,
    });
    expect(storeAccess.remember).toHaveBeenCalledExactlyOnceWith(
      '/Users/alex/Documents',
      true,
      'store-bookmark-token',
    );
  });

  it('opens Privacy & Security settings with fallback, validates schemas, and blocks agent calls', async () => {
    expect(methodWindows.fileAccessPrivacySettings).toBe('both');
    expect(schemas.chooseFolder.safeParse(['/Users/alex/Documents', true]).success).toBe(true);
    expect(schemas.chooseFolder.safeParse(['/Users/alex/Documents']).success).toBe(true);
    expect(schemas.chooseFolder.safeParse([]).success).toBe(true);
    expect(schemas.chooseFolder.safeParse(['/Users/alex/Documents', 'yes']).success).toBe(false);
    expect(schemas.fileAccessPrivacySettings.safeParse([]).success).toBe(true);
    expect(schemas.fileAccessPrivacySettings.safeParse(['files']).success).toBe(true);
    expect(schemas.fileAccessPrivacySettings.safeParse(['all-files']).success).toBe(true);
    expect(schemas.fileAccessPrivacySettings.safeParse(['camera']).success).toBe(false);

    const opened: string[] = [];
    const fallbackOpen = vi.fn(async (url: string) => {
      opened.push(url);
      if (opened.length === 1) throw new Error('anchor unavailable');
    });
    await openPrivacySettings('files', fallbackOpen);
    expect(opened).toEqual(privacySettingsURLs('files'));

    const openURL = vi.fn(async () => {});
    const handlers = createAccessHandlers({
      fileAccess: { scoped: false, list: vi.fn(), revoke: vi.fn(), withBlocked: vi.fn() },
      selections: { revoke: vi.fn() },
      resources: { affected: vi.fn() },
      files: { reset: vi.fn() },
      operations: { exclusive: vi.fn() },
      trash: {
        list: vi.fn(),
        confirmation: vi.fn(),
        preview: vi.fn(),
        copyPaths: vi.fn(),
        chooseRestoreFolder: vi.fn(),
        restoreFootprint: vi.fn(),
        restore: vi.fn(),
        requestAccess: vi.fn(),
      },
      requireWindow: vi.fn(),
      quiesceRoot: vi.fn(),
      refreshIndex: vi.fn(),
      emit: vi.fn(),
      isAgent: (owner) => owner === 99,
      openURL,
    });

    await handlers.fileAccessPrivacySettings(['files'], 1);
    expect(openURL).toHaveBeenLastCalledWith(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders',
    );
    await handlers.fileAccessPrivacySettings(['all-files'], 1);
    expect(openURL).toHaveBeenLastCalledWith(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
    );
    await expect(handlers.fileAccessPrivacySettings(['files'], 99)).rejects.toThrow('person');
  });
});
