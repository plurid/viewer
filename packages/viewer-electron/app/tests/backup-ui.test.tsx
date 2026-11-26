// @vitest-environment jsdom
import path from 'node:path';
import { PersonalBackups } from '../src/desktop/persistence/backup';
import { randomUUID } from 'node:crypto';
import * as publication from '../src/desktop/operations/rename-exclusive';
import { link, readFile, readdir, writeFile } from 'node:fs/promises';
import { temporaryRoot } from '../tools/temporary';
import { SettingsService } from '../src/desktop/preferences/settings';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BackupReply } from '../src/domain/persistence/backup';
import type { ViewerAPI } from '../src/domain/contracts';
import type { ProjectLayout } from '../src/domain/workspaces/project';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { appendRestoredWorkspaces } from '../src/renderer/state/workspaces';
import {
  flushPreferences,
  rememberCommand,
  pendingPreferences,
  resetPreferences,
} from '../src/renderer/state/preferences';
import { BackupDialog } from '../src/renderer/persistence/BackupDialog';
import { activeWorkspace, getState, update } from '../src/renderer/state/core';
import { initialize, flushState } from '../src/renderer/state/store';

HTMLDialogElement.prototype.showModal ??= function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function () {
  this.removeAttribute('open');
};
afterEach(async () => {
  cleanup();
  await flushState(false);
  vi.restoreAllMocks();
});

it('backs up an empty workspace with retained documents without requiring a mounted engine', async () => {
  const backup = vi.fn<ViewerAPI['backup']>(async (request) =>
    request.kind === 'release'
      ? { kind: 'cancelled' }
      : {
          kind: 'review',
          review: {
            id: crypto.randomUUID(),
            mode: 'export',
            created: new Date().toISOString(),
            bytes: 2500,
            workspaces: ['Empty'],
            documents: {
              notes: 2,
              drafts: 1,
              media: 0,
              conversations: 0,
              canvases: 0,
              receipts: 0,
              checks: 0,
            },
            roots: [],
            warnings: [],
          },
        },
  );
  window.viewer = { backup, save: vi.fn(async () => {}) } as unknown as ViewerAPI;
  initialize({
    home: '/fixtures',
    platform: 'darwin',
    locations: [],
    openPaths: [],
    state: {
      version: 11,
      activeWorkspace: 'empty',
      workspaces: [{ id: 'empty', name: 'Empty', panes: [], roots: [], arrangement: {} }],
      favorites: [],
      recents: [],
      look: 'dark',
    },
  });
  const captureLayout = vi.fn(() => {
    throw new Error('No mounted engine');
  });
  render(
    <BackupDialog
      workspace={{ captureLayout } as unknown as WorkspaceController}
      transition={async (change) => change()}
      onClose={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Create Backup…' }));
  await waitFor(() => expect(backup).toHaveBeenCalledWith({ kind: 'prepare-export' }));
  expect(captureLayout).not.toHaveBeenCalled();
  expect(screen.getByText('1 workspace')).toBeTruthy();
  expect(screen.queryByText('0.0 MiB')).toBeNull();
});

it('captures layout for the backup request without setting space.layout or dirtying a clean project', async () => {
  const backup = vi.fn<ViewerAPI['backup']>(async (request) =>
    request.kind === 'release'
      ? { kind: 'cancelled' }
      : {
          kind: 'review',
          review: {
            id: crypto.randomUUID(),
            mode: 'export',
            created: new Date().toISOString(),
            bytes: 2500,
            workspaces: ['Project'],
            documents: {
              notes: 0,
              drafts: 0,
              media: 0,
              conversations: 0,
              canvases: 0,
              receipts: 0,
              checks: 0,
            },
            roots: [],
            warnings: [],
          },
        },
  );
  window.viewer = { backup, save: vi.fn(async () => {}) } as unknown as ViewerAPI;
  initialize({ home: '/fixtures', platform: 'darwin', locations: [], openPaths: [], state: null });
  const space = activeWorkspace();
  update({
    ...getState(),
    saved: {
      ...getState().saved,
      workspaces: [
        {
          ...space,
          project: {
            file: '/fixtures/viewer.project.jsonc',
            root: '/fixtures',
            revision: '1',
            dirty: false,
            bindings: {},
            folders: {},
            definition: {
              version: 1,
              id: 'project-1',
              name: 'Project',
              bindings: [],
              planes: [],
              folders: [],
              layout: { placements: [] },
              arrangements: {},
            },
          },
        },
      ],
    },
  });
  const captured: ProjectLayout = {
    placements: [
      {
        id: space.panes[0]!.id,
        location: { translateX: 0, translateY: 0, translateZ: 0, rotateX: 0, rotateY: 0 },
        width: 600,
        height: 400,
        show: true,
      },
    ],
  };
  render(
    <BackupDialog
      workspace={{ captureLayout: () => captured } as unknown as WorkspaceController}
      transition={async (change) => change()}
      onClose={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Create Backup…' }));
  await waitFor(() =>
    expect(backup).toHaveBeenCalledWith({
      kind: 'prepare-export',
      workspaceID: space.id,
      layout: captured,
    }),
  );
  expect(activeWorkspace().layout).toBeUndefined();
  expect(activeWorkspace().project?.dirty).toBe(false);
});

it('appends and switches restored workspaces while command history awaits a writable configuration', async () => {
  const root = await temporaryRoot('viewer-backup-config-');
  const settings = new SettingsService(
    root,
    '/fixtures',
    () => false,
    () => {},
  );
  await settings.load();
  const initial = settings.snapshot();
  const file = initial.config!.path;
  await writeFile(file, '{');
  await settings.reload();
  const settingsPatch = vi.fn<ViewerAPI['settingsPatch']>((patches, revision) =>
    settings.patch(patches, revision, 'workspace'),
  );
  const save = vi.fn(async () => {});
  window.viewer = { save, settingsPatch } as unknown as ViewerAPI;
  initialize({
    home: '/fixtures',
    platform: 'darwin',
    locations: [],
    openPaths: [],
    state: null,
    settings: initial,
  });
  const state = getState().saved;
  rememberCommand('personal-backup');
  const copy = {
    ...state,
    activeWorkspace: 'restored',
    workspaces: [{ ...activeWorkspace(), id: 'restored', name: 'Restored' }],
  };
  try {
    await expect(flushPreferences()).rejects.toMatchObject({ code: 'SETTINGS_INVALID' });
    settingsPatch.mockClear();
    await appendRestoredWorkspaces(copy);
    expect(activeWorkspace().id).toBe('restored');
    expect(save).toHaveBeenCalled();
    expect(pendingPreferences.has('ui.recentCommands')).toBe(true);
    expect(settingsPatch).not.toHaveBeenCalled();
    expect(await readFile(file, 'utf8')).toBe('{');
  } finally {
    settings.close();
    resetPreferences();
  }
});

it.each([1, 2, 4])(
  'resumes Restore Copies in the same dialog after workspace save %i fails',
  async (failAt) => {
    const root = await temporaryRoot('viewer-backup-append-');
    initialize({ home: root, platform: 'darwin', locations: [], openPaths: [], state: null });
    const original = getState().saved,
      snapshot = getState().settings,
      archive = path.join(root, 'review.json');
    const note = {
      id: randomUUID(),
      kind: 'note',
      title: 'Import record',
      directory: root,
      text: 'Keep the contents',
      revision: 1,
      updated: 1,
    };
    const space = original.workspaces[0]!;
    const archived = {
      ...original,
      workspaces: [
        {
          ...space,
          panes: [
            ...space.panes,
            { id: 'note', type: 'note', documentID: note.id, path: root, title: note.title },
          ],
          roots: [...space.roots, 'note'],
        },
      ],
    };
    vi.spyOn(publication, 'renameExclusive').mockImplementation(link);
    await writeFile(
      archive,
      JSON.stringify({
        format: 'viewer-personal-backup',
        version: 1,
        created: new Date().toISOString(),
        privateRoot: root,
        state: archived,
        preferences: {},
        documents: { notes: [note], drafts: [], media: [], receipts: [], conversations: [] },
      }),
    );
    const imported = vi.fn(),
      close = vi.fn();
    let calls = 0;
    const backups = new PersonalBackups(root, {
      flush: async () => {},
      state: async () => getState().saved,
      settings: () => snapshot,
      choose: async () => archive,
      apply: async () => snapshot,
      registerCheck: async () => {},
      imported,
    });
    const backup = vi.fn<ViewerAPI['backup']>(async (request) => {
      const reply = await backups.request(request, 1);
      if (request.kind === 'release' && failAt === 4) throw new Error('Release reply lost');
      return reply;
    });
    const save = vi.fn(async () => {
      if (++calls === failAt) throw new Error('Workspace save interrupted');
    });
    window.viewer = { backup, save } as unknown as ViewerAPI;
    render(
      <BackupDialog
        workspace={{} as WorkspaceController}
        transition={(change) => change()}
        onClose={close}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open Backup…' }));
    const restore = await screen.findByRole('button', { name: 'Restore Copies' });
    fireEvent.click(restore);
    await screen.findByText('Workspace save interrupted');
    const [first] = backup.mock.results.slice(-1);
    const reply: BackupReply = await first!.value;
    expect(reply.kind).toBe('restored');
    if (reply.kind !== 'restored') throw new Error('Expected restored state');
    const copied = reply.state.workspaces[0]!.panes.find((pane) => pane.type === 'note');
    if (copied?.type !== 'note') throw new Error('Expected restored note');
    const name = copied.documentID + '.json',
      file = path.join(root, 'notes', name);
    if (failAt === 1) {
      const before = await readFile(file, 'utf8');
      expect(JSON.parse(before).text).toBe(note.text);
      await writeFile(file, '{');
      fireEvent.click(restore);
      await screen.findByText(name, { exact: false });
      expect(getState().saved.workspaces.map((item) => item.id)).toEqual(
        original.workspaces.map((item) => item.id),
      );
      expect(close).not.toHaveBeenCalled();
      expect(await readFile(file, 'utf8')).toBe('{');
      await writeFile(file, before);
    }
    fireEvent.click(restore);
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect((await readdir(path.dirname(file))).filter((entry) => entry.endsWith('.json'))).toEqual([
      name,
    ]);
    expect(imported).toHaveBeenCalledOnce();
    expect(getState().saved.workspaces.map((space) => space.id)).toEqual([
      ...original.workspaces.map((space) => space.id),
      ...reply.state.workspaces.map((space) => space.id),
    ]);
    expect(getState().saved.activeWorkspace).toBe(reply.state.activeWorkspace);
    const request = backup.mock.calls.map(([r]) => r).find((r) => r.kind === 'restore')!;
    await expect(backups.request(request, 1)).rejects.toThrow('expired');
  },
);
