// @vitest-environment jsdom
import { chmodSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { link, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FolderAccessButton,
  resetFolderAccessAttempts,
} from '../src/renderer/ui/permissions/FolderAccessButton';
import { PersonalBackups, backupSchema } from '../src/desktop/persistence/backup';
import { getState } from '../src/renderer/state/core';
import { publishExclusiveFile } from '../src/desktop/persistence/exclusive-file';
import * as publication from '../src/desktop/operations/rename-exclusive';
import { FileAccess } from '../src/desktop/files/file-access';
import { chooseRemembered, saveOnce } from '../src/desktop/native/dialogs';
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
import { temporaryRoot, trashTemporary } from '../tools/temporary';

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
    initialize({
      home: '/Users/alex',
      platform: 'darwin',
      state: null,
      locations: [],
      openPaths: [],
    });
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
    const root = await temporaryRoot('viewer-folder-recovery-');
    const home = path.join(root, 'home');
    const projects = path.join(home, 'Projects');
    const documents = path.join(home, 'Documents');
    await mkdir(projects, { recursive: true });
    await mkdir(documents, { recursive: true });
    try {
      const inWindowPrompts: string[] = [];
      const holder: { win?: BrowserWindow } = {};
      const { win } = stubWindow(11, (event) => {
        if (event.type === 'dialog' && event.prompt?.kind === 'file') {
          inWindowPrompts.push(event.prompt.id);
          void windowDialogs(holder.win!, false)?.request({
            kind: 'choose',
            id: event.prompt.id,
            paths: [projects],
          });
        }
      });
      holder.win = win;
      // Register a window dialog host as the direct build does for ordinary folder picks.
      const dialogs = new WindowDialogs({
        home,
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
        { properties: ['openDirectory'], defaultPath: home },
        true,
        false,
      );
      expect(ordinary).toBe(projects);
      expect(inWindowPrompts).toHaveLength(1);
      expect(electronMock.dialog.showOpenDialog).not.toHaveBeenCalled();

      // Permission recovery passes native=true and bypasses the in-window dialog.
      electronMock.dialog.showOpenDialog.mockResolvedValueOnce({
        canceled: false,
        filePaths: [documents],
      });
      const recovered = await chooseRemembered(
        directAccess,
        win,
        { properties: ['openDirectory'], defaultPath: documents },
        true,
        true,
      );
      expect(recovered).toBe(documents);
      expect(inWindowPrompts).toHaveLength(1);
      expect(electronMock.dialog.showOpenDialog).toHaveBeenCalledExactlyOnceWith(win, {
        properties: ['openDirectory'],
        defaultPath: documents,
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
        filePaths: [documents],
        bookmarks: ['store-bookmark-token'],
      });
      const storeChosen = await chooseRemembered(
        storeAccess,
        win,
        { properties: ['openDirectory'], defaultPath: documents },
        true,
        true,
      );
      expect(storeChosen).toBe(documents);
      expect(electronMock.dialog.showOpenDialog).toHaveBeenLastCalledWith(win, {
        properties: ['openDirectory'],
        defaultPath: documents,
        securityScopedBookmarks: true,
      });
      expect(storeAccess.remember).toHaveBeenCalledExactlyOnceWith(
        documents,
        true,
        'store-bookmark-token',
      );
    } finally {
      await trashTemporary(root);
    }
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

it('asks for a Store backup folder and keeps an occupied backup intact', async () => {
  const root = await temporaryRoot('viewer-backup-panel-');
  const folder = path.join(root, 'Chosen');
  await mkdir(folder);
  const access = new FileAccess(path.join(root, 'private'), {
    start: (bookmark) => {
      if (bookmark === 'directory') chmodSync(root, 0o700);
      return () => {};
    },
  });
  const occupied = path.join(folder, 'Viewer-date.viewer-backup.json');
  await writeFile(occupied, 'original');
  await access.allowOnce(occupied, 'single-file');
  const placeholder = path.join(folder, 'placeholder');
  electronMock.dialog.showSaveDialog.mockResolvedValue({
    canceled: false,
    filePath: placeholder,
    bookmark: 'file-only',
  });
  electronMock.dialog.showOpenDialog.mockResolvedValueOnce({
    canceled: false,
    filePaths: [folder],
    bookmarks: ['directory'],
  });
  const publish = vi.spyOn(publication, 'renameExclusive').mockImplementation(link);
  try {
    initialize({ home: root, platform: 'darwin', locations: [], openPaths: [], state: null });
    const backups = new PersonalBackups(root, {
      flush: async () => {},
      state: async () => getState().saved,
      settings: () => getState().settings,
      apply: async () => getState().settings,
      registerCheck: async () => {},
      choose: async () =>
        (await saveOnce(
          access,
          undefined,
          { defaultPath: 'Viewer-date.viewer-backup.json' },
          'backup',
        )) ?? null,
    });
    const prepared = await backups.request({ kind: 'prepare-export' }, 1);
    if (prepared.kind !== 'review') throw new Error('Expected a backup review');
    chmodSync(root, 0o000);
    const result = await backups.request({ kind: 'write', id: prepared.review.id }, 1);
    if (result.kind !== 'written') throw new Error('Expected a saved backup');
    const chosen = path.join(folder, result.name);
    expect(chosen).not.toBe(occupied);
    expect(chosen).not.toBe(placeholder);
    await access.require([folder, chosen]);
    expect(backupSchema.parse(JSON.parse(await readFile(chosen, 'utf8'))).privateRoot).toBe(root);
    await expect(publishExclusiveFile(chosen, 'replacement')).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(await readFile(occupied, 'utf8')).toBe('original');
    expect(electronMock.dialog.showOpenDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({
        properties: expect.arrayContaining(['openDirectory']),
        securityScopedBookmarks: true,
      }),
    );
  } finally {
    chmodSync(root, 0o700);
    publish.mockRestore();
    await access.close();
  }
});
