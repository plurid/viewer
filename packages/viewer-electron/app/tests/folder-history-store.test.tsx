// @vitest-environment jsdom
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CheckedFolder } from '../src/domain/files/folder-checks';
import type { CommandContext } from '../src/renderer/commands/registry';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { temporaryRoot } from '../tools/temporary';
import { FileAccess } from '../src/desktop/files/file-access';
import { createFileHandlers } from '../src/desktop/ipc/file-handlers';
import { createFolderHistoryChecks } from '../src/desktop/windows/folder-history-checks';
import { GoToFolderDialog } from '../src/renderer/explorer/GoToFolderDialog';
import { CommandPalette } from '../src/renderer/commands/CommandPalette';
import { CommandsContext } from '../src/renderer/commands/context';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { WorkspaceContext } from '../src/renderer/workspace/context';
import { activeWorkspace, getState, savePatch } from '../src/renderer/state/core';
import { initialize } from '../src/renderer/state/workspaces';
import { navigate } from '../src/renderer/state/panes';
import { flushState } from '../src/renderer/state/persistence';

vi.mock('electron', () => ({ shell: {} }));
vi.mock('../src/desktop/workers/utility-client', async () => {
  const { checkHistoryFolder } = await import('../src/desktop/files/folder-history');
  return {
    launchWorker: () => {
      let receive: ((reply: { value: CheckedFolder }) => void) | undefined;
      return {
        postMessage: (file: string) => {
          let value: CheckedFolder;
          try {
            value = checkHistoryFolder(file);
          } catch {
            value = { directory: false, unavailable: true };
          }
          queueMicrotask(() => receive?.({ value }));
        },
        message: (listener: typeof receive) => {
          receive = listener;
        },
        exit: () => {},
        thread: { terminate: async () => {}, on: () => {} },
      };
    },
  };
});
HTMLDialogElement.prototype.showModal ??= function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function () {
  this.removeAttribute('open');
};
HTMLElement.prototype.scrollIntoView ??= function () {};
let access: FileAccess | undefined;
let checks: ReturnType<typeof createFolderHistoryChecks> | undefined;
afterEach(async () => {
  cleanup();
  await flushState(false);
  checks?.close();
  await access?.close();
});

it.each(['Go to folder', 'z'])(
  '%s lists two remembered folders under an unused Store grant and opens through ordinary navigation',
  async (surface) => {
    const root = await temporaryRoot('viewer-store-history-');
    const grant = path.join(root, 'Granted');
    const first = path.join(grant, 'Projects');
    const second = path.join(grant, 'Projects archive');
    await mkdir(first, { recursive: true });
    await mkdir(second);
    const stop = vi.fn();
    const start = vi.fn(() => stop);
    access = new FileAccess(path.join(root, 'private'), { start });
    Reflect.set(access, 'store', {
      load: async () => ({
        version: 1,
        grants: [{ path: grant, directory: true, bookmark: 'fixture' }],
      }),
    });
    checks = createFolderHistoryChecks('/fixtures/history-worker.cjs', access);
    const handlers = createFileHandlers({
      fileAccess: access,
      files: { inspect: vi.fn(), sizeStart: vi.fn(), sizeGet: vi.fn(), sizeCancel: vi.fn() },
      information: { get: vi.fn(), update: vi.fn() },
      watchers: { add: vi.fn(), remove: vi.fn() },
    });
    const stat = vi.fn((file: string) => handlers.stat([file], 1));
    Object.assign(window, {
      viewer: {
        folderCheck: checks.check,
        stat,
        save: vi.fn(async () => {}),
        settingsPatch: vi.fn(),
        list: vi.fn(async () => ({ entries: [] })),
        onEvent: () => () => {},
      },
    });
    initialize({ home: root, platform: 'darwin', state: null, locations: [], openPaths: [] });
    const now = Date.now();
    savePatch({ visits: { [first]: { count: 30, last: now }, [second]: { count: 2, last: now } } });
    const paneID = getState().activePane;
    const open = vi.fn(async (file: string) => {
      navigate(paneID, file);
    });
    if (surface === 'Go to folder') {
      render(<GoToFolderDialog onOpen={open} onClose={vi.fn()} />);
    } else {
      const registry = new CommandRegistry();
      const context = (): CommandContext => ({
        scope: 'window',
        workspaceID: activeWorkspace().id,
        paneID,
        directory: root,
        selection: [],
        clipboard: null,
        jobs: [],
      });
      registry.register('window', { context, definitions: () => [] });
      render(
        <CommandsContext.Provider value={registry}>
          <WorkspaceContext.Provider value={{ openPath: open } as unknown as WorkspaceController}>
            <CommandPalette
              mode="commands"
              initialQuery="z projects"
              onMode={vi.fn()}
              onClose={vi.fn()}
            />
          </WorkspaceContext.Provider>
        </CommandsContext.Provider>,
      );
    }
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    const rows = screen.getAllByRole('option');
    expect(rows[0]?.textContent).toContain(first);
    expect(rows[1]?.textContent).toContain(second);
    expect(screen.queryByText(/couldn't check some folders/)).toBeNull();
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
    expect(checks.paths).toEqual([]);
    const field = screen.getByRole('combobox');
    if (surface === 'Go to folder') fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(first, ...(surface === 'z' ? [expect.any(Object)] : [])),
    );
    expect(activeWorkspace().panes.find((pane) => pane.id === paneID)?.path).toBe(first);
    expect(stat).toHaveBeenCalledWith(first);
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
  },
);
