import type { CheckDocument } from '../src/domain/fabrication/check-document';
import type { FileHandle } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as publication from '../src/desktop/operations/rename-exclusive';
import { restoreCanvasBackupAssets } from '../src/desktop/persistence/backup-canvases';
import { temporalIdentity } from '../src/domain/files/item-identity';
import { randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { PersonalBackups, backupSchema } from '../src/desktop/persistence/backup';
import {
  backupIdentityMap,
  backupRoots,
  restoreBackupState,
} from '../src/desktop/persistence/backup-state';
import { repeatedPreviewFixture } from './workspace-fixtures';
import { Storage, stateSchema } from '../src/desktop/persistence/storage';
import { defaultSettings } from '../src/domain/services';
import type { SettingsPatch, SettingsSnapshot } from '../src/domain/services';
import type { SavedState } from '../src/domain/contracts';
import type { BackupReply } from '../src/domain/persistence/backup';
import { normalizePreferences } from '../src/domain/preferences/ui';
import { readText } from '../src/desktop/editing/text-files';
import { SettingsService } from '../src/desktop/preferences/settings';
import { temporaryRoot } from '../tools/temporary';
import { CheckStore } from '../src/desktop/fabrication/check-store';
import { checkDocumentSchema } from '../src/domain/fabrication/check-document';
import { CURRENT_STATE_VERSION } from '../src/domain/contracts';
import { Canvases } from '../src/desktop/canvases/service';
import { ChatDocumentStore } from '../src/desktop/chat/documents';
import { chatDocumentSchema } from '../src/domain/models/chat';

function personalBackups(
  root: string,
  host: Omit<ConstructorParameters<typeof PersonalBackups>[1], 'registerCheck'> & {
    registerCheck?: (document: CheckDocument) => Promise<void>;
  },
) {
  const checks = new CheckStore(path.join(root, 'fabrication-checks'));
  return new PersonalBackups(root, {
    registerCheck: (document) => checks.register(document),
    ...host,
  });
}

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

it('backs up independent canvas branches, saved values and assets with no imported file authority', async () => {
  const root = await temporaryRoot('viewer-backup-canvases-');
  const first = path.join(root, 'First'),
    second = path.join(root, 'Second');
  const archive = path.join(root, 'canvas-backup.json');
  const source = path.join(root, 'source.svg');
  await writeFile(source, '<svg xmlns="http://www.w3.org/2000/svg"/>', { flag: 'wx' });
  const chatID = randomUUID(),
    branchID = randomUUID(),
    messageID = randomUUID();
  const canvases = new Canvases(first, { changed: () => {} });
  const original = await canvases.create(1, chatID, root);
  const asset = await canvases.attachFile(1, original.id, source);
  const content = await canvases.write(1, original.id, 1, 'Budget', '<p>Budget</p>', {
    budget: 25,
  });
  await canvases.state(1, original.id, content.stateRevision, content.revision, { budget: 42 });
  const branch = await canvases.fork(1, original.id, branchID);
  const chat = chatDocumentSchema.parse({
    version: 4,
    id: chatID,
    title: 'Budget',
    path: root,
    providerID: '',
    scopes: [],
    messages: [{ id: messageID, role: 'assistant', text: 'Budget', at: 1 }],
    draft: '',
    draftRevision: 0,
    revision: 1,
    updated: 1,
    status: 'idle',
    level: 'images',
    canvasID: original.id,
  });
  await new ChatDocumentStore(path.join(first, 'chat-documents', chatID + '.json')).save(chat);
  await new ChatDocumentStore(path.join(first, 'chat-documents', branchID + '.json')).save({
    ...chat,
    id: branchID,
    canvasID: branch.id,
    messages: [],
    branch: {
      conversationID: chatID,
      messageID,
      revision: 1,
      quote: 'Budget',
      start: 0,
      end: 6,
      context: chat.messages,
    },
  });
  const state = saved(root);
  state.workspaces[0]!.panes.push({
    id: 'canvas',
    type: 'canvas',
    path: root,
    canvasID: original.id,
    title: 'Budget',
  });
  const host = {
    flush: async () => {},
    state: async () => state,
    settings: () => snapshot(root),
    apply: async () => snapshot(root),
    choose: async () => archive,
  };
  const exporter = personalBackups(first, host);
  const prepared = review(await exporter.request({ kind: 'prepare-export' }, 1));
  expect(prepared.documents.canvases).toBe(2);
  await exporter.request({ kind: 'write', id: prepared.id }, 1);
  const bundle = backupSchema.parse(JSON.parse(await readFile(archive, 'utf8')));
  expect(bundle.canvasAssets).toHaveLength(1);
  const importer = personalBackups(second, { ...host, state: async () => null });
  const incoming = review(await importer.request({ kind: 'choose-import' }, 2));
  const restored = await importer.request(
    { kind: 'restore', id: incoming.id, preferences: false },
    2,
  );
  if (restored.kind !== 'restored') throw new Error('Expected restored work');
  const pane = restored.state.workspaces[0]!.panes.find((pane) => pane.type === 'canvas')!;
  if (pane.type !== 'canvas') throw new Error('Expected canvas');
  expect(pane.canvasID).not.toBe(original.id);
  const copies = new Canvases(second, { changed: () => {} });
  const copy = await copies.read(2, pane.canvasID);
  expect(copy.state.budget).toBe(42);
  expect(copy.assets[0]!.id).toBe(asset.id);
  expect(copy.assets[0]!.source).toBeUndefined();
  expect(await copies.assetBytes(copy.assets[0]!)).toEqual(await readFile(source));
  const conversations = await Promise.all(
    (await readdir(path.join(second, 'chat-documents'))).map(async (file) =>
      chatDocumentSchema.parse(
        JSON.parse(await readFile(path.join(second, 'chat-documents', file), 'utf8')),
      ),
    ),
  );
  const child = conversations.find((item) => item.branch)!;
  expect(child.branch!.conversationID).toBe(copy.conversationID);
  const fork = await copies.read(2, child.canvasID!);
  expect(fork.fork!.id).toBe(copy.id);
  expect(fork.assets[0]!.source).toBeUndefined();
  await copies.write(2, fork.id, fork.revision, 'Alternative', '<p>Alternative</p>', {
    budget: 25,
  });
  const applied = await copies.apply(2, fork.id, fork.revision + 1);
  expect(applied.state.budget).toBe(42);
  expect(await readFile(source, 'utf8')).toContain('<svg');

  const invalid = path.join(root, 'invalid-backup.json');
  bundle.canvasAssets[0]!.data = Buffer.from('changed').toString('base64');
  await writeFile(invalid, JSON.stringify(bundle), { flag: 'wx' });
  const refused = personalBackups(path.join(root, 'Refused'), {
    ...host,
    choose: async () => invalid,
  });
  await expect(refused.request({ kind: 'choose-import' }, 3)).rejects.toThrow('invalid');
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
      _sourceVersion: { identity: temporalIdentity('old'), modified: 1, size: 8 },
    },
  };
  state.previewHistory = {
    workspace: [
      {
        path: file,
        updated: 1,
        values: {
          'pdf.page': 3,
          _sourceVersion: { identity: temporalIdentity('old'), modified: 1, size: 8 },
        },
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
  const exporter = personalBackups(first, host);
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
  const importer = personalBackups(second, {
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
    const personalImport = personalBackups(second, {
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
  const backups = personalBackups(root, {
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
    original = JSON.stringify({ ...saved(root), version: CURRENT_STATE_VERSION + 1 });
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
  const backups = personalBackups(root, {
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
  const backups = personalBackups(root, {
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
  await Promise.all([
    backups.exported().then(async () => {
      expect(backupSchema.parse(JSON.parse(await readFile(file, 'utf8'))).privateRoot).toBe(root);
    }),
    expect(written).resolves.toMatchObject({ kind: 'written' }),
  ]);
});

it('restores checks as inspectable copies, remaps stack identities, and never restores execution authority', async () => {
  const root = await temporaryRoot('viewer-backup-checks-');
  const first = path.join(root, 'First'),
    second = path.join(root, 'Second');
  const source = path.join(root, 'Job'),
    target = path.join(root, 'Relinked');
  for (const folder of [first, second, source, target]) await mkdir(folder);
  const checkID = randomUUID();
  const version = { identity: temporalIdentity('captured-source'), modified: 1, size: 5 };
  const requirement = {
    status: 'human-confirmed' as const,
    key: 'finding:F1',
    kind: 'pitch' as const,
    value: 50,
    unit: 'mm' as const,
    evidence: { ref: 'S1', page: 1, version, quote: null },
    part: 'S2',
    confirmedAt: 2,
  };
  const { status: _status, ...confirmation } = requirement;
  const document = checkDocumentSchema.parse({
    version: 1,
    id: checkID,
    created: 1,
    updated: 2,
    status: 'running',
    paths: [source],
    folder: source,
    job: 'Retained job',
    skipped: [],
    sources: [
      {
        ref: 'S1',
        kind: 'drawing',
        name: 'drawing.pdf',
        path: path.join(source, 'drawing.pdf'),
        version,
      },
    ],
    confirmations: [confirmation],
    corrections: { F1: randomUUID() },
    result: {
      kind: 'result',
      id: checkID,
      provider: { name: 'Meta', model: 'fixture' },
      summary: 'Previously paid result',
      request: [],
      findings: [],
      issues: [],
      parts: [],
      notSent: [],
      seconds: 3,
      tour: { name: 'Retained job', root: source, stops: [], skipped: [] },
      requirements: [
        {
          claim: {
            key: 'finding:F1',
            kind: 'pitch',
            ref: 'S1',
            page: 1,
            value: 50,
            quote: null,
            part: 'S2',
          },
          verification: requirement,
        },
      ],
    },
  });
  const firstStore = new CheckStore(path.join(first, 'fabrication-checks'));
  await firstStore.save(document);
  const state = saved(source),
    space = state.workspaces[0]!;
  space.panes.push({ id: 'check', type: 'check', checkID, path: source, title: 'Retained job' });
  const location = { translateX: 0, translateY: 0, translateZ: 0, rotateX: 0, rotateY: 0 };
  space.layout = {
    placements: ['a', 'check'].map((id) => ({ id, location, width: 800, height: 600, show: true })),
    stacks: [
      { id: 'stack', panes: ['a', 'check'], previous: { a: { location }, check: { location } } },
    ],
  };
  const archive = path.join(root, 'backup.json');
  const host = {
    flush: async () => firstStore.flush(),
    state: async () => state,
    settings: () => snapshot(source),
    apply: async () => snapshot(source),
    choose: async () => archive,
  };
  const exporter = personalBackups(first, host);
  const pending = review(await exporter.request({ kind: 'prepare-export' }, 1));
  expect(pending.documents.checks).toBe(1);
  await exporter.request({ kind: 'write', id: pending.id }, 1);
  const bundle = backupSchema.parse(JSON.parse(await readFile(archive, 'utf8')));
  expect(bundle.documents.checks[0]?.result?.summary).toBe('Previously paid result');
  const store = new CheckStore(path.join(second, 'fabrication-checks'));
  const live = { ...document, id: randomUUID(), job: 'Live check', result: undefined };
  const registerCheck = vi.fn(async (doc: typeof document) => {
    await Promise.all([store.register(doc), store.save(live)]);
  });
  const importer = personalBackups(second, {
    ...host,
    registerCheck,
    state: async () => null,
    choose: async (_owner, kind) => (kind === 'folder' ? target : archive),
  });
  const importing = review(await importer.request({ kind: 'choose-import' }, 2));
  await importer.request({ kind: 'relink', id: importing.id, root: source }, 2);
  const restored = await importer.request(
    { kind: 'restore', id: importing.id, preferences: false },
    2,
  );
  if (restored.kind !== 'restored') throw new Error('Expected restored check.');
  const pane = restored.state.workspaces[0]!.panes.find((pane) => pane.type === 'check')!;
  if (pane.type !== 'check') throw new Error('Missing check plane.');
  expect(pane.checkID).not.toBe(checkID);
  expect(registerCheck).toHaveBeenCalledOnce();
  expect(await store.list()).toMatchObject([
    { id: pane.checkID, folder: target, status: 'interrupted' },
    { id: live.id },
  ]);
  const copy = (await store.read(pane.checkID))!;
  expect(copy.paths).toEqual([target]);
  expect(copy.sources[0]?.path).toBe(path.join(target, 'drawing.pdf'));
  expect(copy.result?.requirements?.[0]?.verification).toEqual(requirement);
  expect(copy.verification).toBeUndefined();
  expect(copy.confirmations).toEqual([]);
  expect(copy.corrections).toEqual({});
  expect(copy.error).toContain('inspection');
  const stack = restored.state.workspaces[0]!.layout!.stacks![0]!;
  expect(stack.id).not.toBe('stack');
  expect(stack.panes).toContain(pane.id);
  expect(Object.keys(stack.previous)).toEqual(stack.panes);
  expect((await firstStore.read(checkID))?.confirmations).toHaveLength(1);

  const { checks: _checks, ...legacyDocuments } = bundle.documents;
  expect(backupSchema.parse({ ...bundle, documents: legacyDocuments }).documents.checks).toEqual(
    [],
  );
  const incomplete = path.join(root, 'incomplete.json');
  await writeFile(incomplete, JSON.stringify({ ...bundle, documents: legacyDocuments }), {
    flag: 'wx',
  });
  const missing = personalBackups(second, { ...host, choose: async () => incomplete });
  await expect(missing.request({ kind: 'choose-import' }, 3)).rejects.toThrow(
    'private document is missing',
  );
});

it('embeds a prepared workspace layout into the exported backup without mutating live state', async () => {
  const root = await temporaryRoot('viewer-backup-layout-');
  const archive = path.join(root, 'layout-backup.json');
  const state = saved(root);
  const space = state.workspaces[0]!;
  expect(space.layout).toBeUndefined();
  const capturedLayout = {
    placements: [
      {
        id: space.panes[0]!.id,
        location: { translateX: 12, translateY: 34, translateZ: 0, rotateX: 0, rotateY: 0 },
        width: 720,
        height: 480,
        show: true,
      },
    ],
  };
  const backups = personalBackups(root, {
    flush: async () => {},
    state: async () => state,
    settings: () => snapshot(root),
    apply: async () => snapshot(root),
    choose: async () => archive,
  });
  const pending = review(
    await backups.request(
      { kind: 'prepare-export', workspaceID: space.id, layout: capturedLayout },
      1,
    ),
  );
  await backups.request({ kind: 'write', id: pending.id }, 1);
  const bundle = backupSchema.parse(JSON.parse(await readFile(archive, 'utf8')));
  expect(bundle.state.workspaces[0]?.layout).toEqual(capturedLayout);
  expect(state.workspaces[0]?.layout).toBeUndefined();
});

it('restores a workspace with an external session as an independently exportable copy', async () => {
  const root = await temporaryRoot('viewer-session-backup-');
  let state = saved(root);
  const space = state.workspaces[0]!;
  const session = randomUUID();
  const reference = {
    kind: 'chat' as const,
    conversationID: session,
    externalSessionID: session,
    path: root,
  };
  space.panes.push({
    id: 'agent',
    type: 'chat',
    path: root,
    conversationID: session,
    externalSessionID: session,
  });
  space.roots.push('agent');
  space.activePane = 'agent';
  space.tiling = { panes: ['agent'], tree: { pane: 'agent' }, layout: 'tiled', main: 0.5 };
  space.taskAreas = [
    {
      id: randomUUID(),
      name: 'Job',
      checkout: { path: root, observed: 0 },
      created: 0,
      updated: 0,
      members: [{ id: randomUUID(), title: 'Agent', reference, views: ['agent'] }],
    },
  ];
  const backups = personalBackups(root, {
    flush: async () => {},
    state: async () => state,
    settings: () => snapshot(root),
    apply: async () => snapshot(root),
    choose: async () => path.join(root, 'backup.json'),
  });
  const exported = review(await backups.request({ kind: 'prepare-export' }, 1));
  await backups.request({ kind: 'write', id: exported.id }, 1);
  const imported = review(await backups.request({ kind: 'choose-import' }, 1));
  const restored = await backups.request(
    { kind: 'restore', id: imported.id, preferences: false },
    1,
  );
  if (restored.kind !== 'restored') throw new Error('Expected restored workspaces');
  state = restored.state;
  await expect(backups.request({ kind: 'prepare-export' }, 1)).resolves.toMatchObject({
    kind: 'review',
  });
  const copy = state.workspaces[0]!;
  expect(copy.taskAreas?.[0]?.members).toEqual([]);
  expect(copy.tiling).toBeUndefined();
  expect(copy.roots).toEqual([copy.panes[0]!.id]);
  expect(copy.activePane).toBe(copy.roots[0]);
});

it('relinks nesting inputs, folder dismissals and tool library locations', () => {
  const state = saved('/old/output');
  const part = '/drawings/part.dxf';
  state.workspaces[0]!.panes.push(
    {
      id: 'layout',
      type: 'layout',
      path: '/old/output',
      sources: [part],
      quantities: { [part]: 6 },
      thicknesses: { [part]: 3 },
    },
    { id: 'library', type: 'tools', path: '/catalog/tools' },
  );
  state.ui!.insightsDismissed = { '/drawings': ['folder.summary'] };
  const copy = restoreBackupState(state, backupIdentityMap(state, []), [
    { source: '/drawings', destination: '/new' },
  ]);
  expect(copy.workspaces[0]!.panes[1]).toMatchObject({
    sources: ['/new/part.dxf'],
    quantities: { '/new/part.dxf': 6 },
    thicknesses: { '/new/part.dxf': 3 },
  });
  expect(copy.ui?.insightsDismissed).toEqual({ '/new': ['folder.summary'] });
  expect(backupRoots(state, '/private-profile', [])).toEqual(
    expect.arrayContaining(['/catalog/tools', '/drawings', '/old/output']),
  );
});

async function importWithNote(root: string, recentCommands: string[] = [], diagnostic?: string) {
  const archive = path.join(root, 'source.json');
  const state = saved(root);
  state.ui!.recentCommands = recentCommands;
  const note = {
    id: randomUUID(),
    kind: 'note',
    title: 'Original',
    directory: root,
    text: 'hello',
    revision: 1,
    updated: 0,
  };
  const documents = { notes: [note], drafts: [], media: [], conversations: [], receipts: [] };
  await writeFile(
    archive,
    JSON.stringify({
      format: 'viewer-personal-backup',
      version: 1,
      created: new Date().toISOString(),
      privateRoot: root,
      state,
      preferences: {},
      documents,
    }),
  );
  const destination = path.join(root, 'destination');
  const settings = snapshot(root);
  if (diagnostic)
    settings.config = {
      path: 'config.jsonc',
      diagnostics: [diagnostic],
      changes: [],
      warnings: [],
    };
  const backups = personalBackups(destination, {
    flush: async () => {},
    state: async () => null,
    settings: () => settings,
    apply: async () => settings,
    choose: async () => archive,
  });
  const incoming = review(await backups.request({ kind: 'choose-import' }, 1));
  return { backups, incoming, destination };
}

it.each(['diagnostic', 'invalid UI'])(
  'preflights %s before creating restored documents',
  async (reason) => {
    const root = await temporaryRoot('viewer-backup-preferences-');
    const { backups, incoming, destination } = await importWithNote(
      root,
      reason === 'invalid UI' ? ['a'.repeat(201)] : [],
      reason === 'diagnostic' ? 'Invalid config.jsonc' : undefined,
    );
    await expect(
      backups.request({ kind: 'restore', id: incoming.id, preferences: true }, 1),
    ).rejects.toThrow();
    await expect(readdir(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      backups.request({ kind: 'restore', id: incoming.id, preferences: false }, 1),
    ).resolves.toMatchObject({ kind: 'restored' });
  },
);

it.each(['export', 'note', 'asset'])(
  'keeps partial %s writes out of published paths',
  async (kind) => {
    const root = await temporaryRoot('viewer-backup-partial-');
    const { backups, incoming, destination } = await importWithNote(root);
    const file = path.join(root, 'export.json');
    const exporter = personalBackups(root, {
      flush: async () => {},
      state: async () => saved(root),
      settings: () => snapshot(root),
      apply: async () => snapshot(root),
      choose: async () => file,
    });
    const exporting = review(await exporter.request({ kind: 'prepare-export' }, 1));
    const bytes = Buffer.from('canvas bytes');
    const asset = {
      hash: createHash('sha256').update(bytes).digest('hex'),
      data: bytes.toString('base64'),
    };
    const probe = await open(path.join(root, 'handle'), 'wx');
    const fail = vi
      .spyOn(Object.getPrototypeOf(probe), 'writeFile')
      .mockImplementationOnce(async function (this: FileHandle) {
        await this.write('partial');
        throw new Error('Disk full');
      });
    try {
      const writing =
        kind === 'note'
          ? backups.request({ kind: 'restore', id: incoming.id, preferences: false }, 1)
          : kind === 'asset'
            ? restoreCanvasBackupAssets(destination, [asset])
            : exporter.request({ kind: 'write', id: exporting.id }, 1);
      await expect(writing).rejects.toThrow('Disk full');
    } finally {
      fail.mockRestore();
      await probe.close();
    }
    if (kind === 'note')
      expect(
        (await readdir(path.join(destination, 'notes'))).filter((name) => name.endsWith('.json')),
      ).toEqual([]);
    else
      await expect(
        readFile(kind === 'asset' ? path.join(destination, 'canvas-assets', asset.hash) : file),
      ).rejects.toMatchObject({ code: 'ENOENT' });
  },
);

it('imports a saved session layout, prunes its stack and tiles, and exports the surviving child', async () => {
  const state = saved('/job');
  const space = state.workspaces[0]!;
  const session = randomUUID();
  const location = { translateX: 1, translateY: 2, translateZ: 0, rotateX: 0, rotateY: 0 };
  space.panes.push({
    type: 'chat',
    id: 'agent',
    conversationID: session,
    externalSessionID: session,
    path: '/job',
  });
  space.activePane = 'agent';
  space.arrangement = { camera: '{"scale":2}', tree: '{"root":"/chats/agent"}' };
  space.roots = ['agent'];
  space.layout = {
    placements: ['agent', 'a'].map((id) => ({
      id,
      parent: id === 'a' ? 'agent' : undefined,
      location,
      width: 800,
      height: 600,
      show: true,
    })),
    active: 'agent',
    docked: 'agent',
    stacks: [
      { id: 'pair', panes: ['a', 'agent'], previous: { a: { location }, agent: { location } } },
    ],
  };
  space.tiling = {
    layout: 'tiled',
    main: 0.5,
    panes: ['a', 'agent'],
    tree: { axis: 'x', ratio: 0.5, first: { pane: 'a' }, second: { pane: 'agent' } },
  };
  const root = await temporaryRoot('viewer-backup-existing-session-');
  const file = path.join(root, 'saved.viewer-backup.json');
  await writeFile(
    file,
    JSON.stringify({
      format: 'viewer-personal-backup',
      version: 1,
      created: new Date().toISOString(),
      privateRoot: root,
      state,
      preferences: {},
      documents: { notes: [], drafts: [], media: [], conversations: [], receipts: [] },
    }),
  );
  let current: SavedState | null = null;
  const backups = personalBackups(root, {
    state: async () => current,
    flush: async () => {},
    settings: () => snapshot(root),
    apply: async () => snapshot(root),
    choose: async () => file,
  });
  const imported = review(await backups.request({ kind: 'choose-import' }, 1));
  const restored = await backups.request(
    { kind: 'restore', id: imported.id, preferences: false },
    1,
  );
  if (restored.kind !== 'restored') throw new Error('Expected a restored workspace');
  current = restored.state;
  const copy = current.workspaces[0]!;
  expect(copy.panes).toHaveLength(1);
  expect(copy.panes[0]?.type).toBe('folder');
  const child = copy.panes[0]!.id;
  await expect(backups.request({ kind: 'prepare-export' }, 1)).resolves.toMatchObject({
    kind: 'review',
  });
  expect(copy.roots).toEqual([child]);
  expect(copy.activePane).toBe(child);
  expect(copy.layout?.placements).toEqual([
    { id: child, parent: undefined, location, width: 800, height: 600, show: true },
  ]);
  expect(copy.arrangement).toEqual({ camera: '{"scale":2}' });
  expect(copy.layout?.active).toBeUndefined();
  expect(copy.layout?.docked).toBeUndefined();
  expect(copy.layout?.stacks).toEqual([]);
  expect(copy.tiling?.tree).toEqual({ pane: child });
});

it.each(['external-chat', 'app'])(
  'keeps the inactive Plurid tree and camera when omitting external session %s',
  (session) => {
    const state = repeatedPreviewFixture('/job');
    const space = state.workspaces[0]!;
    const key = 'pluridState-viewer-' + space.id;
    const engine = JSON.parse(space.arrangement[key]!);
    engine.space.bookmarks = { Front: { camera: engine.space.camera } };
    const front = engine.space.tree[0];
    const kept = front.children[1].planeID;
    engine.space.links = [{ sourcePlaneID: kept, targetPlaneID: front.planeID }];
    engine.space.selectedPlaneIDs = [kept];
    const route = 'plurid://app/chats/' + session;
    engine.space.tree.push({ route, planeID: route + '@0', children: [] });
    engine.space.links.push({ sourcePlaneID: route + '@0', targetPlaneID: kept });
    engine.space.selectedPlaneIDs.push(route + '@0');
    engine.space.activePlaneID = route + '@0';
    space.arrangement[key] = JSON.stringify(engine);
    space.roots.push(session);
    space.panes.push({
      type: 'chat',
      id: session,
      path: '/job',
      conversationID: session,
      externalSessionID: session,
    });
    state.workspaces.unshift({
      ...space,
      id: 'visible',
      name: 'Visible',
      panes: [{ ...space.panes[0]!, id: 'x' }],
      roots: ['x'],
      arrangement: {},
    });
    state.activeWorkspace = 'visible';
    const ids = backupIdentityMap(state, []);
    const copy = restoreBackupState(state, ids, []).workspaces[1]!;
    expect(copy.roots).toEqual([ids.get('reused-folder')]);
    const snapshot = JSON.parse(copy.arrangement['pluridState-viewer-' + copy.id]!);
    expect(snapshot.space.camera).toEqual(engine.space.camera);
    expect(snapshot.space.bookmarks).toEqual(engine.space.bookmarks);
    expect(snapshot.space.tree).toHaveLength(1);
    expect(snapshot.space.tree[0].children).toHaveLength(3);
    expect(snapshot.space.tree[0].children[0].parentPlaneID).toBe(
      'plurid://app/folders/' + ids.get('reused-folder') + '@0',
    );
    expect(snapshot.space.links).toHaveLength(1);
    expect(snapshot.space.selectedPlaneIDs).toHaveLength(1);
    expect(snapshot.space.activePlaneID).toBe('');
    expect(JSON.stringify(snapshot)).not.toContain(route + '@0');
  },
);
it.each([
  ['/', '/new', '/part.dxf', '/new/part.dxf'],
  ['/old', '/', '/old/part.dxf', '/part.dxf'],
])('relinks root paths from %s to %s', (source, destination, file, target) => {
  const state = saved('/job');
  state.workspaces[0]!.panes.push({
    id: 'layout',
    type: 'layout',
    path: source,
    sources: [file],
    quantities: { [file]: 7 },
    thicknesses: { [file]: 2 },
  });
  const restored = restoreBackupState(state, backupIdentityMap(state, []), [
    { source, destination },
  ]);
  expect(restored.workspaces[0]!.panes[1]).toMatchObject({
    sources: [target],
    quantities: { [target]: 7 },
    thicknesses: { [target]: 2 },
  });
});
it('indexes thousands of sibling source folders without pairwise containment checks', () => {
  const state = saved('/output');
  const folders = Array.from({ length: 4000 }, (_, i) => '/jobs/job-' + i);
  const original = path.relative;
  const relative = vi.spyOn(path, 'relative').mockImplementation((from, to) => {
    if (relative.mock.calls.length >= 4 * folders.length) throw new Error('Pairwise folder scan');
    return original(from, to);
  });
  try {
    const roots = backupRoots(state, '/profile', [...folders, folders[0] + '/nested']);
    expect(roots).toHaveLength(folders.length + 1);
    expect(roots).toContain(folders[0]);
    expect(relative.mock.calls.length).toBeLessThan(4 * folders.length);
  } finally {
    relative.mockRestore();
  }
});
it('reuses verified canvas assets when new writes would fail', async () => {
  const root = await temporaryRoot('viewer-asset-reuse-');
  const bytes = Buffer.from('saved asset');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const folder = path.join(root, 'canvas-assets');
  await mkdir(folder);
  await writeFile(path.join(folder, hash), bytes);
  const handle = await open(path.join(folder, hash), 'r');
  const write = vi
    .spyOn(Object.getPrototypeOf(handle), 'writeFile')
    .mockRejectedValue(new Error('Disk full'));
  try {
    await restoreCanvasBackupAssets(root, [{ hash, data: bytes.toString('base64') }]);
    expect(write).not.toHaveBeenCalled();
  } finally {
    write.mockRestore();
    await handle.close();
  }
});

it.each([false, true])(
  'resumes the same note and check after a settings conflict (note edited: %s)',
  async (edited) => {
    const root = await temporaryRoot('viewer-restore-conflict-');
    const { destination } = await importWithNote(root);
    const file = path.join(root, 'source.json');
    const archive = JSON.parse(await readFile(file, 'utf8'));
    archive.documents.checks = [
      {
        version: 1,
        id: randomUUID(),
        created: 1,
        updated: 1,
        status: 'interrupted',
        paths: [root],
        folder: root,
        job: 'Job',
        sources: [],
        skipped: [],
        confirmations: [],
        corrections: {},
        handoffs: [],
      },
    ];
    archive.preferences = { appearance: 'light' };
    await writeFile(file, JSON.stringify(archive));
    const store = new CheckStore(path.join(destination, 'fabrication-checks'));
    const settings = new SettingsService(
      destination,
      root,
      () => false,
      () => {},
    );
    await settings.load();
    const registerCheck = vi.fn(async (doc: CheckDocument) => {
      await store.register(doc);
      await settings.patch(
        [{ path: 'settings.appearance', value: 'dark' }],
        settings.snapshot().revision,
      );
    });
    const backups = personalBackups(destination, {
      flush: async () => {},
      state: async () => null,
      settings: (refresh) => (refresh ? settings.reload() : settings.snapshot()),
      choose: async () => file,
      registerCheck,
      apply: (patches, revision) => settings.patch(patches, revision),
    });
    const reviewID = review(await backups.request({ kind: 'choose-import' }, 1)).id;
    const request = { kind: 'restore' as const, id: reviewID, preferences: true };
    const publish = vi.spyOn(publication, 'renameExclusive').mockImplementation(link);
    try {
      await expect(backups.request(request, 1)).rejects.toMatchObject({
        code: 'SETTINGS_CONFLICT',
      });
      expect(settings.snapshot().settings.appearance).toBe('dark');
      const notes = async () =>
        (await readdir(path.join(destination, 'notes'))).filter((n) => n.endsWith('.json'));
      const before = await notes();
      expect(before).toHaveLength(1);
      const checks = await store.list();
      expect(checks).toHaveLength(1);
      if (edited) {
        const file = path.join(destination, 'notes', before[0]!);
        const change = 'Edited after the settings conflict';
        await writeFile(file, change);
        await expect(backups.request(request, 1)).rejects.toThrow('changed after');
        expect(await readFile(file, 'utf8')).toBe(change);
      } else {
        await expect(backups.request(request, 1)).resolves.toMatchObject({ kind: 'restored' });
        expect(settings.snapshot().settings.appearance).toBe('light');
      }
      expect(await notes()).toEqual(before);
      expect(await store.list()).toEqual(checks);
      expect(registerCheck).toHaveBeenCalledTimes(1);
    } finally {
      settings.close();
      publish.mockRestore();
    }
  },
);
it('requests a workspace-only barrier before restoring without preferences', async () => {
  const root = await temporaryRoot('viewer-backup-barrier-');
  const { destination } = await importWithNote(root);
  const flush = vi.fn(async (scope?: string) => {
    if (scope !== 'workspace') throw new Error('Invalid config.jsonc');
  });
  const backups = personalBackups(destination, {
    flush,
    state: async () => null,
    settings: () => snapshot(root),
    apply: async () => snapshot(root),
    choose: async () => path.join(root, 'source.json'),
  });
  const id = review(await backups.request({ kind: 'choose-import' }, 1)).id;
  const publish = vi.spyOn(publication, 'renameExclusive').mockImplementation(link);
  try {
    await expect(
      backups.request({ kind: 'restore', id, preferences: false }, 1),
    ).resolves.toMatchObject({ kind: 'restored' });
  } finally {
    publish.mockRestore();
  }
});

it('relinks a drawing using the normalized folder offered for its path', () => {
  const drawing = '/source//drawings/part.dxf',
    other = '/unrelated//folder/part.dxf';
  const state = saved('/elsewhere');
  state.workspaces[0]!.panes.push({
    id: 'drawing',
    type: 'layout',
    path: '/plates',
    sources: [drawing, other],
    quantities: { [drawing]: 4 },
    thicknesses: { [drawing]: 3 },
  });
  const offered = backupRoots(state, '/private', []).find((x) => x === '/source/drawings')!;
  expect(offered).toBe('/source/drawings');
  const copy = restoreBackupState(state, backupIdentityMap(state, []), [
    { source: offered, destination: '/new' },
  ]);
  expect(copy.workspaces[0]!.panes.at(-1)).toMatchObject({
    sources: ['/new/part.dxf', other],
    quantities: { '/new/part.dxf': 4 },
    thicknesses: { '/new/part.dxf': 3 },
  });
});
it('promotes a surviving pane without placements when its only root was omitted', () => {
  const state = saved('/job'),
    space = state.workspaces[0]!;
  space.panes.push({
    id: 'external',
    type: 'chat',
    conversationID: randomUUID(),
    externalSessionID: randomUUID(),
    path: '/job',
  });
  space.roots = ['external'];
  const ids = backupIdentityMap(state, []);
  expect(restoreBackupState(state, ids, []).workspaces[0]!.roots).toEqual([ids.get('a')]);
});
it.each([50, 160])('remaps every plane in a deep inactive engine snapshot of depth %i', (depth) => {
  const state = repeatedPreviewFixture('/job'),
    space = state.workspaces[0]!;
  const folder = space.panes[0]!,
    key = 'pluridState-viewer-' + space.id,
    engine = JSON.parse(space.arrangement[key]!);
  const route = (id: string) => 'plurid://app/folders/' + id;
  const external = {
    id: 'external',
    type: 'chat' as const,
    conversationID: randomUUID(),
    externalSessionID: randomUUID(),
    path: '/job',
  };
  space.panes = [external];
  space.roots = ['folder-0', 'external'];
  space.activePane = 'folder-0';
  const tree = (engine.space.tree = [{ route: 'plurid://app/chats/external', children: [] }]);
  let children = tree;
  for (let level = 0; level < depth; level++) {
    const id = 'folder-' + level;
    space.panes.push({ ...folder, id });
    const node = {
      route: route(id),
      sourceID: route(id),
      planeID: route(id) + '@0',
      children: [],
      routeDivisions: { plane: { parameters: { id } } },
    };
    children.push(node);
    children = node.children;
  }
  space.arrangement[key] = JSON.stringify(engine);
  state.workspaces.unshift({
    id: 'visible',
    name: 'Visible',
    roots: [],
    panes: [],
    arrangement: {},
  });
  state.activeWorkspace = 'visible';
  const checked = stateSchema.parse(state),
    ids = backupIdentityMap(checked, []);
  const copied = stateSchema.parse(restoreBackupState(checked, ids, [])).workspaces[1]!;
  let branch = JSON.parse(copied.arrangement['pluridState-viewer-' + copied.id]!).space.tree;
  for (const pane of copied.panes) {
    expect(branch).toHaveLength(1);
    expect(branch[0]).toMatchObject({
      route: route(pane.id),
      sourceID: route(pane.id),
      planeID: route(pane.id) + '@0',
      routeDivisions: { plane: { parameters: { id: pane.id } } },
    });
    branch = branch[0].children;
  }
  expect(branch).toHaveLength(0);
});

it('rejects a damaged engine snapshot when pruning an external session', () => {
  const state = repeatedPreviewFixture('/job'),
    space = state.workspaces[0]!;
  space.panes.push({
    id: 'external',
    type: 'chat',
    conversationID: randomUUID(),
    externalSessionID: randomUUID(),
    path: '/job',
  });
  space.arrangement['pluridState-viewer-' + space.id] = 'plurid://app/chats/external';
  expect(() => restoreBackupState(state, backupIdentityMap(state, []), [])).toThrow();
});
it('rejects unresolved route parameters in a copied plane', () => {
  const state = repeatedPreviewFixture('/job'),
    space = state.workspaces[0]!;
  const key = 'pluridState-viewer-' + space.id,
    snapshot = JSON.parse(space.arrangement[key]!);
  snapshot.space.tree[0].children[0].routeDivisions.plane.parameters.id = 'missing';
  space.arrangement[key] = JSON.stringify(snapshot);
  expect(() => restoreBackupState(state, backupIdentityMap(state, []), [])).toThrow(
    'unknown plane',
  );
});

it('retains parent traversal through a folder link when relinking a Preview', async () => {
  const root = await temporaryRoot('viewer-restore-path-');
  const source = path.join(root, 'Source'),
    destination = path.join(root, 'Restored');
  for (const base of [source, destination]) {
    await mkdir(path.join(base, 'Shared', 'Sub'), { recursive: true });
    await symlink('Shared/Sub', path.join(base, 'Parts'));
    await writeFile(path.join(base, 'Shared', 'sheet.dxf'), 'Drawing inside Shared');
    await writeFile(path.join(base, 'sheet.dxf'), 'Different drawing');
  }
  const suffix = 'Parts/../sheet.dxf',
    file = source + '//' + suffix;
  const state = saved(source),
    space = state.workspaces[0]!;
  space.panes = [{ id: 'file', type: 'preview', path: file }];
  space.roots = ['file'];
  space.activePane = 'file';
  expect(await readFile(file, 'utf8')).toBe('Drawing inside Shared');
  expect(backupRoots(state, path.join(root, 'Private'), [])).toEqual([source]);
  const copied = restoreBackupState(state, backupIdentityMap(state, []), [{ source, destination }])
    .workspaces[0]!.panes[0]!;
  expect(await readFile(copied.path, 'utf8')).toBe('Drawing inside Shared');
  expect(copied.path).toBe(destination + '/' + suffix);
});

it('checks a copied canvas asset again before completing the workspace append', async () => {
  const root = await temporaryRoot('viewer-copied-asset-');
  const profile = path.join(root, 'profile'),
    archive = path.join(root, 'archive.json');
  const bytes = Buffer.from('asset content'),
    hash = createHash('sha256').update(bytes).digest('hex');
  const chatID = randomUUID(),
    canvasID = randomUUID(),
    state = saved(root);
  const asset = {
    id: randomUUID(),
    name: 'input.txt',
    mime: 'text/plain',
    bytes: bytes.length,
    hash,
  };
  const canvas = {
    version: 2,
    id: canvasID,
    conversationID: chatID,
    path: root,
    revision: 1,
    title: 'Canvas',
    html: '',
    defaults: {},
    assets: [asset],
    at: 1,
    state: {},
    stateRevision: 1,
    history: [],
  };
  const chat = {
    version: 4,
    id: chatID,
    title: 'Canvas',
    path: root,
    providerID: '',
    scopes: [],
    messages: [],
    draft: '',
    draftRevision: 0,
    revision: 1,
    updated: 1,
    status: 'idle',
    level: 'images',
    canvasID,
  };
  state.workspaces[0]!.panes.push({
    id: 'canvas',
    type: 'canvas',
    path: root,
    canvasID,
    title: 'Canvas',
  });
  await writeFile(
    archive,
    JSON.stringify({
      format: 'viewer-personal-backup',
      version: 1,
      created: new Date().toISOString(),
      privateRoot: root,
      state,
      preferences: {},
      documents: {
        notes: [],
        drafts: [],
        media: [],
        receipts: [],
        conversations: [chat],
        canvases: [canvas],
      },
      canvasAssets: [{ hash, data: bytes.toString('base64') }],
    }),
  );
  const imported = vi.fn();
  const importer = personalBackups(profile, {
    flush: async () => {},
    state: async () => null,
    settings: () => snapshot(root),
    apply: async () => snapshot(root),
    choose: async () => archive,
    imported,
  });
  const incoming = review(await importer.request({ kind: 'choose-import' }, 1));
  const request = { kind: 'restore' as const, id: incoming.id, preferences: false };
  const publish = vi.spyOn(publication, 'renameExclusive').mockImplementation(link);
  try {
    const restored = await importer.request(request, 1);
    const file = path.join(profile, 'canvas-assets', hash);
    const changed = Buffer.alloc(bytes.length, 0);
    await writeFile(file, changed);
    await expect(importer.request(request, 1)).rejects.toThrow('canvas-assets/' + hash);
    expect(await readFile(file)).toEqual(changed);
    await writeFile(file, bytes);
    await expect(importer.request(request, 1)).resolves.toEqual(restored);
    expect(imported).toHaveBeenCalledOnce();
  } finally {
    publish.mockRestore();
  }
});
