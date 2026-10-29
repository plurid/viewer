import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { PersonalBackups, backupSchema } from '../src/desktop/persistence/backup';
import { backupIdentityMap, restoreBackupState } from '../src/desktop/persistence/backup-state';
import { Storage, stateSchema } from '../src/desktop/persistence/storage';
import { defaultSettings } from '../src/domain/services';
import type { SettingsPatch, SettingsSnapshot } from '../src/domain/services';
import type { SavedState } from '../src/domain/contracts';
import type { BackupReply } from '../src/domain/persistence/backup';
import { normalizePreferences } from '../src/domain/preferences/ui';
import { readText } from '../src/desktop/editing/text-files';
import { SettingsService } from '../src/desktop/preferences/settings';
import { temporaryRoot } from '../tools/temporary';

const saved = (folder: string): SavedState => ({
  version: 11,
  look: 'dark',
  favorites: [],
  recents: [],
  activeWorkspace: 'workspace',
  ui: normalizePreferences(),
  workspaces: [
    {
      id: 'workspace',
      name: 'Original',
      roots: ['a'],
      activePane: 'a',
      arrangement: {},
      panes: [
        {
          id: 'a',
          type: 'folder',
          path: folder,
          history: [folder],
          historyIndex: 0,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
        },
      ],
    },
  ],
});
const review = (reply: BackupReply) => {
  if (reply.kind !== 'review') throw new Error('Expected backup review');
  return reply.review;
};
const snapshot = (home: string): SettingsSnapshot => ({
  revision: 1,
  settings: defaultSettings(home),
  ui: normalizePreferences(),
  look: 'dark',
  credentials: ['secret-provider'],
});

it('round trips private work as independent copies, relinks paths, and preserves source files', async () => {
  const root = await temporaryRoot('viewer-backup-roundtrip-');
  const source = path.join(root, 'Original files'),
    target = path.join(root, 'Relinked files');
  const first = path.join(root, 'First profile'),
    second = path.join(root, 'Second profile');
  for (const directory of [
    source,
    target,
    first,
    second,
    path.join(first, 'notes'),
    path.join(first, 'text-buffers'),
  ])
    await mkdir(directory);
  const file = path.join(source, 'draft.txt');
  await writeFile(file, 'Original', { flag: 'wx' });
  await writeFile(path.join(target, 'draft.txt'), 'Original', { flag: 'wx' });
  const base = (await readText(file)).version;
  const note = {
    id: randomUUID(),
    kind: 'checklist',
    title: 'Keep this',
    directory: source,
    text: '- [ ] Finish',
    revision: 2,
    updated: 42,
  };
  const draft = {
    id: randomUUID(),
    kind: 'file',
    file,
    base,
    text: 'Unsaved changes',
    revision: 3,
    updated: 43,
  };
  await writeFile(path.join(first, 'notes', note.id + '.json'), JSON.stringify(note), {
    flag: 'wx',
  });
  await writeFile(path.join(first, 'text-buffers', draft.id + '.json'), JSON.stringify(draft), {
    flag: 'wx',
  });
  const state = saved(source);
  state.ui!.space.headerControls.back = false;
  state.workspaces[0]!.panes.push(
    { id: 'note', type: 'note', documentID: note.id, title: note.title, path: source },
    { id: 'draft', type: 'preview', bufferID: draft.id, path: file },
    {
      id: 'terminal',
      type: 'terminal',
      path: source,
      profileID: 'shell',
      taskSessionID: 'old-logical-session',
      startOnOpen: true,
    },
  );
  state.previewStates = {
    'workspace:draft': {
      'text.scale': 18,
      'scroll.text': 120,
      _sourceVersion: { identity: 'old', modified: 1, size: 8 },
    },
  };
  state.previewHistory = {
    workspace: [
      {
        path: file,
        updated: 1,
        values: { 'pdf.page': 3, _sourceVersion: { identity: 'old', modified: 1, size: 8 } },
      },
    ],
  };
  state.workspaces[0]!.arrangement = {
    engine: JSON.stringify({ route: '/folders/a', id: 'a', label: 'a document', child: 'draft' }),
  };
  const settings = snapshot(source);
  settings.settings.browsing.scrollbars = 'always';
  settings.settings.toolbars = { folder: ['missing:extension', 'new-folder'] };
  const archive = path.join(root, 'Personal.viewer-backup.json');
  const host = {
    flush: vi.fn(async () => {}),
    state: async () => state,
    settings: () => settings,
    apply: vi.fn(async (_patches: SettingsPatch[]) => settings),
    choose: vi.fn(async () => archive),
  };
  const exporter = new PersonalBackups(first, host);
  const exported = review(await exporter.request({ kind: 'prepare-export' }, 1));
  expect(exported.documents).toMatchObject({ notes: 1, drafts: 1 });
  await expect(exporter.request({ kind: 'write', id: exported.id }, 99)).rejects.toThrow('expired');
  await exporter.request({ kind: 'write', id: exported.id }, 1);
  const originalBytes = await readFile(archive);
  const bundle = backupSchema.parse(JSON.parse(originalBytes.toString('utf8')));
  expect(bundle.preferences).not.toHaveProperty('providers');
  expect(bundle.preferences).not.toHaveProperty('agents');
  expect(bundle).not.toHaveProperty('credentials');
  expect(bundle.preferences.toolbars?.folder).toEqual(['missing:extension', 'new-folder']);

  const current = saved(target);
  current.workspaces[0]!.id = 'existing';
  current.activeWorkspace = 'existing';
  const applied = vi.fn(async (_patches: SettingsPatch[]) => settings);
  const importer = new PersonalBackups(second, {
    ...host,
    state: async () => current,
    apply: applied,
    textVersion: async (file) => (await readText(file)).version,
    choose: async (_owner, kind) => (kind === 'folder' ? target : archive),
  });
  const imported = review(await importer.request({ kind: 'choose-import' }, 2));
  expect(imported.roots.map((item) => item.source)).toContain(source);
  await importer.request({ kind: 'relink', id: imported.id, root: source }, 2);
  const restored = await importer.request(
    { kind: 'restore', id: imported.id, preferences: false },
    2,
  );
  if (restored.kind !== 'restored') throw new Error('Expected restored work');
  expect(applied).not.toHaveBeenCalled();
  stateSchema.parse(restored.state);
  const space = restored.state.workspaces[0]!;
  expect(space.id).not.toBe(state.workspaces[0]!.id);
  expect(space.panes.find((pane) => pane.type === 'terminal')).toMatchObject({
    startOnOpen: false,
  });
  expect(space.panes.find((pane) => pane.type === 'terminal')).not.toMatchObject({
    taskSessionID: 'old-logical-session',
  });
  expect(space.panes.every((pane) => pane.path.startsWith(target))).toBe(true);
  expect(JSON.parse(space.arrangement.engine!)).toMatchObject({
    route: '/folders/' + space.panes[0]!.id,
    label: 'a document',
  });
  expect(Object.values(restored.state.previewStates!)[0]).toEqual({
    'text.scale': 18,
    'scroll.text': 120,
  });
  expect(restored.state.previewHistory?.[space.id]?.[0]?.values).toEqual({ 'pdf.page': 3 });
  const restoredNote = JSON.parse(
    await readFile(
      path.join(second, 'notes', (await readdir(path.join(second, 'notes')))[0]!),
      'utf8',
    ),
  );
  expect(restoredNote).toMatchObject({ text: note.text, directory: target });
  expect(restoredNote.id).not.toBe(note.id);
  const restoredDraft = JSON.parse(
    await readFile(
      path.join(second, 'text-buffers', (await readdir(path.join(second, 'text-buffers')))[0]!),
      'utf8',
    ),
  );
  expect(restoredDraft).toMatchObject({
    text: 'Unsaved changes',
    file: path.join(target, 'draft.txt'),
    base: (await readText(path.join(target, 'draft.txt'))).version,
  });
  expect(await readFile(archive)).toEqual(originalBytes);
  expect(await readFile(file, 'utf8')).toBe('Original');
  expect(current.workspaces).toHaveLength(1);
  const destinationSettings = new SettingsService(
    second,
    target,
    () => true,
    () => {},
  );
  try {
    await destinationSettings.load();
    const before = destinationSettings.snapshot();
    const personalImport = new PersonalBackups(second, {
      ...host,
      state: async () => current,
      settings: () => destinationSettings.snapshot(),
      apply: (patches) =>
        destinationSettings.patch(patches, destinationSettings.snapshot().revision),
      choose: async (_owner, kind) => (kind === 'folder' ? target : archive),
    });
    const pending = review(await personalImport.request({ kind: 'choose-import' }, 3));
    await personalImport.request({ kind: 'relink', id: pending.id, root: source }, 3);
    const reply = await personalImport.request(
      { kind: 'restore', id: pending.id, preferences: true },
      3,
    );
    if (reply.kind !== 'restored') throw new Error('Expected personal preferences');
    expect(reply.settings.settings.browsing.scrollbars).toBe('always');
    expect(reply.settings.settings.toolbars.folder).toEqual(['missing:extension', 'new-folder']);
    expect(reply.settings.ui.space.headerControls.back).toBe(false);
    expect(reply.settings.settings.providers).toEqual(before.settings.providers);
    expect(reply.settings.settings.agents).toEqual(before.settings.agents);
  } finally {
    destinationSettings.close();
  }
});

it('refuses unsupported, incomplete, linked and conflicting backups without modifying existing work', async () => {
  const root = await temporaryRoot('viewer-backup-rejections-');
  const state = saved(root),
    settings = snapshot(root);
  const file = path.join(root, 'backup.json');
  let chosen = file;
  const backups = new PersonalBackups(root, {
    flush: async () => {},
    state: async () => state,
    settings: () => settings,
    apply: async () => settings,
    choose: async () => chosen,
  });
  await writeFile(file, JSON.stringify({ format: 'viewer-personal-backup', version: 99 }), {
    flag: 'wx',
  });
  await expect(backups.request({ kind: 'choose-import' }, 1)).rejects.toThrow('newer Viewer');
  const link = path.join(root, 'linked.json');
  await symlink(file, link);
  chosen = link;
  await expect(backups.request({ kind: 'choose-import' }, 1)).rejects.toThrow();
  chosen = file;
  state.workspaces[0]!.panes.push({
    type: 'note',
    id: 'missing',
    path: root,
    documentID: randomUUID(),
    title: 'Missing',
  });
  await expect(backups.request({ kind: 'prepare-export' }, 1)).rejects.toThrow('incomplete');
  state.workspaces[0]!.panes.pop();
  const prepared = review(await backups.request({ kind: 'prepare-export' }, 1));
  await expect(backups.request({ kind: 'write', id: prepared.id }, 1)).rejects.toMatchObject({
    code: 'EEXIST',
  });
  expect(JSON.parse(await readFile(file, 'utf8')).version).toBe(99);
  await backups.request({ kind: 'release', id: prepared.id }, 1);
  await expect(backups.request({ kind: 'write', id: prepared.id }, 1)).rejects.toThrow('expired');
});

it('keeps every supported saved-state version and protects a newer format in place', async () => {
  const root = await temporaryRoot('viewer-backup-compatibility-');
  for (let version = 1; version <= 11; version++) {
    const state = saved('/fixtures');
    state.version = version as SavedState['version'];
    state.ui!.space.headerControls.sidebar = false;
    const first = stateSchema.parse(state),
      second = stateSchema.parse(JSON.parse(JSON.stringify(first)));
    const ids = backupIdentityMap(second, []);
    expect(restoreBackupState(second, ids, []).ui?.space.headerControls.sidebar).toBe(false);
  }
  const file = path.join(root, 'newer-state.json'),
    original = JSON.stringify({ ...saved(root), version: 12 });
  await writeFile(file, original, { flag: 'wx' });
  const storage = new Storage(file);
  expect((await storage.load()).recovery).toContain('newer Viewer');
  await expect(storage.save(saved(root))).rejects.toMatchObject({ code: 'STATE_RETAINED' });
  expect(await readFile(file, 'utf8')).toBe(original);
  expect(await readdir(root)).toEqual(['newer-state.json']);
});

it('discards a pending review when its window closes', async () => {
  const root = await temporaryRoot('viewer-backup-closed-');
  let release!: () => void;
  const backups = new PersonalBackups(root, {
    state: async () => saved(root),
    settings: () => snapshot(root),
    apply: async () => snapshot(root),
    choose: async () => null,
    flush: () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  });
  const pending = backups.request({ kind: 'prepare-export' }, 1);
  const rejected = expect(pending).rejects.toThrow('window closed');
  backups.stopOwner(1);
  release();
  await rejected;
});

it('lets Quit wait for an export being written, not for its file dialog', async () => {
  const root = await temporaryRoot('viewer-backup-quit-');
  const file = path.join(root, 'backup.json');
  let choose!: (file: string) => void;
  const backups = new PersonalBackups(root, {
    flush: async () => {},
    state: async () => saved(root),
    settings: () => snapshot(root),
    apply: async () => snapshot(root),
    choose: () =>
      new Promise<string>((resolve) => {
        choose = resolve;
      }),
  });
  const prepared = review(await backups.request({ kind: 'prepare-export' }, 1));
  const written = backups.request({ kind: 'write', id: prepared.id }, 1);
  await vi.waitFor(() => expect(choose).toBeDefined());
  await expect(backups.exported()).resolves.toBeUndefined();
  const write = Reflect.get(backups, 'write') as (...args: unknown[]) => Promise<void>;
  let started!: () => void;
  const writing = new Promise<void>((resolve) => {
    started = resolve;
  });
  Reflect.set(backups, 'write', (...args: unknown[]) => {
    started();
    return write.apply(backups, args);
  });
  choose(file);
  await writing;
  await backups.exported();
  expect(backupSchema.parse(JSON.parse(await readFile(file, 'utf8'))).privateRoot).toBe(root);
  await expect(written).resolves.toMatchObject({ kind: 'written' });
});
