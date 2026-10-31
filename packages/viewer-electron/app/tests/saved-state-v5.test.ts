/**
 * Scratch planes: saved state version 5 adds the scratch plane and a preview's unsaved
 * edits. A version 4 file is backed up before its first version 5 save, as each format change was.
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Storage, stateSchema } from '../src/desktop/persistence/storage';
import { CURRENT_STATE_VERSION, type SavedState } from '../src/domain/contracts';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string;
beforeEach(async () => {
  root = await temporaryRoot('viewer-state-v5-');
});
afterEach(async () => {
  await trashTemporary(root);
});
const state = (version: number, panes: unknown[]) => ({
  version,
  workspaces: [
    {
      id: 'w',
      name: 'Work',
      panes,
      roots: (panes as { id: string }[]).map((pane) => pane.id),
      arrangement: {},
    },
  ],
  activeWorkspace: 'w',
  favorites: [],
  recents: [],
  look: 'dark',
});

it('uses the current plane format', () => {
  expect(CURRENT_STATE_VERSION).toBe(12);
});
it('preserves version 11 before adding check views, pins and stacks', async () => {
  const storage = new Storage(path.join(root, 'state.json'));
  const previous = stateSchema.parse(
    state(11, [
      { id: 'drawing', type: 'preview', path: path.join(root, 'part.dxf') },
      { id: 'request', type: 'preview', path: path.join(root, 'request.pdf') },
    ]),
  );
  const location = { translateX: 120, translateY: 80, translateZ: 0, rotateX: 0, rotateY: 0 };
  previous.workspaces[0]!.layout = {
    active: 'drawing',
    placements: previous.workspaces[0]!.panes.map(({ id }, index) => ({
      id,
      location: { ...location, translateX: location.translateX + index * 900 },
      width: 800,
      height: 600,
      show: true,
    })),
  };
  const original = JSON.stringify(previous, null, 2);
  await writeFile(storage.file, original, { flag: 'wx' });
  const loaded = await storage.load();
  expect(loaded.recovery).toBeUndefined();
  expect(loaded.state?.version).toBe(12);
  expect(loaded.state?.workspaces).toEqual(previous.workspaces);
  expect(await readFile(storage.file, 'utf8')).toBe(original);
  const backups = (await readdir(root)).filter((file) => file.includes('before-workshop-v12'));
  expect(backups).toHaveLength(1);
  const backup = path.join(root, backups[0]!);
  expect(await readFile(backup, 'utf8')).toBe(original);
  expect((await stat(backup)).mode & 0o777).toBe(0o600);
  await storage.save(loaded.state!);
  expect(JSON.parse(await readFile(storage.file, 'utf8')).version).toBe(12);
  expect(await readFile(backup, 'utf8')).toBe(original);
});

it('round trips check references, pinned rectangles and stack restoration positions in version 12', async () => {
  const storage = new Storage(path.join(root, 'state.json'));
  const checkID = '6f1c2c0a-6a43-4c51-9e3e-6f3f0d3b9a01';
  const next = stateSchema.parse(
    state(12, [
      {
        id: 'check',
        type: 'check',
        path: root,
        checkID,
        title: 'Job check',
      },
      { id: 'drawing', type: 'preview', path: path.join(root, 'part.dxf') },
      { id: 'request', type: 'preview', path: path.join(root, 'request.pdf') },
    ]),
  );
  const location = { translateX: 40, translateY: 120, translateZ: 0, rotateX: 0, rotateY: 0 };
  next.workspaces[0]!.layout = {
    active: 'check',
    placements: [
      {
        id: 'check',
        location,
        width: 600,
        height: 700,
        show: true,
        pinned: {
          rect: { x: 0.75, y: 0.1, width: 0.2, height: 0.8, unit: 'fraction', anchor: 'top-right' },
          collapsed: false,
          order: 1,
        },
      },
      {
        id: 'drawing',
        location: { ...location, translateX: 800 },
        width: 800,
        height: 600,
        show: true,
      },
      {
        id: 'request',
        location: { ...location, translateX: 824, translateY: 144 },
        width: 800,
        height: 600,
        show: true,
      },
    ],
    stacks: [
      {
        id: 'evidence-stack',
        panes: ['drawing', 'request'],
        previous: {
          drawing: { location: { ...location, translateX: 850 }, manuallyPositioned: true },
          request: { location: { ...location, translateX: 1800 }, manuallyPositioned: false },
        },
      },
    ],
  };
  await storage.save(next);
  const restored = await new Storage(storage.file).load();
  expect(restored.recovery).toBeUndefined();
  expect(restored.state?.workspaces).toEqual(next.workspaces);
  const bytes = JSON.parse(await readFile(storage.file, 'utf8'));
  expect(bytes.version).toBe(12);
  expect(bytes.workspaces[0].panes[0]).toMatchObject({ type: 'check', checkID });
  expect(await readdir(root)).toEqual(['state.json']);
});
it('backs up version 8 before adding durable note views', async () => {
  const storage = new Storage(path.join(root, 'state.json'));
  const original = JSON.stringify(state(8, []), null, 2);
  await writeFile(storage.file, original);
  expect((await storage.load()).state?.version).toBe(CURRENT_STATE_VERSION);
  const backup = (await readdir(root)).find((file) => file.includes('before-notes-v9'))!;
  expect(await readFile(path.join(root, backup), 'utf8')).toBe(original);
  const note = {
    id: 'note',
    type: 'note',
    path: root,
    documentID: '6f1c2c0a-6a43-4c51-9e3e-6f3f0d3b9a01',
    title: 'Saved privately',
  };
  await storage.save(state(9, [note]) as SavedState);
  expect((await storage.load()).state?.workspaces[0]?.panes).toEqual([note]);
});
it('backs up a version 4 file before migrating it, leaving the original as it was', async () => {
  const storage = new Storage(path.join(root, 'state.json'));
  const original = JSON.stringify(state(4, []));
  await writeFile(storage.file, original);
  const loaded = (await storage.load()).state!;
  expect(loaded.version).toBe(CURRENT_STATE_VERSION);
  expect(await readFile(storage.file, 'utf8')).toBe(original);
  const backup = (await readdir(root)).find((file) => file.includes('before-planes-v6'))!;
  expect(await readFile(path.join(root, backup), 'utf8')).toBe(original);
});
it('keeps scratch planes and the unsaved edits of a preview', async () => {
  const storage = new Storage(path.join(root, 'state.json'));
  const panes = [
    {
      id: 'scratch',
      type: 'scratch',
      path: root,
      bufferID: '6f1c2c0a-6a43-4c51-9e3e-6f3f0d3b9a01',
      title: 'Untitled 1',
      language: 'markdown',
    },
    {
      id: 'preview',
      type: 'preview',
      path: path.join(root, 'notes.txt'),
      bufferID: '0b6f3a52-0a8e-4c7e-8d0f-58f3f3b7f1c2',
    },
  ];
  await storage.save(state(5, panes) as SavedState);
  expect((await storage.load()).state?.workspaces[0]?.panes).toEqual(panes);
});

it.each([1, 2, 3, 4, 5, 6])(
  'backs up original version %s bytes before profile-overlay migration',
  async (version) => {
    const storage = new Storage(path.join(root, 'state.json'));
    const original = JSON.stringify(state(version, []), null, 2);
    await writeFile(storage.file, original);
    const loaded = (await storage.load()).state!;
    expect(loaded.version).toBe(CURRENT_STATE_VERSION);
    expect(await readFile(storage.file, 'utf8')).toBe(original);
    const backup = (await readdir(root)).find((file) =>
      file.includes('before-profile-overlays-v7'),
    );
    expect(backup).toBeDefined();
    expect(await readFile(path.join(root, backup!), 'utf8')).toBe(original);
  },
);

function malformedNameBytes(version: number): Buffer {
  const bytes = Buffer.from(JSON.stringify(state(version, [])));
  const name = bytes.indexOf(Buffer.from('Work'));
  if (name < 0) throw new Error('The state fixture must include its workspace name.');
  bytes[name + 1] = 0xff;
  return bytes;
}

it('preserves malformed UTF-8 bytes in a parseable version 6 migration backup', async () => {
  const storage = new Storage(path.join(root, 'state.json'));
  const original = malformedNameBytes(6);
  expect(Buffer.from(original.toString('utf8'))).not.toEqual(original);
  await writeFile(storage.file, original);

  const loaded = await storage.load();
  expect(loaded.recovery).toBeUndefined();
  expect(loaded.state?.version).toBe(CURRENT_STATE_VERSION);
  expect(loaded.state?.workspaces[0]?.name).toBe('W\uFFFDrk');
  expect(await readFile(storage.file)).toEqual(original);
  const backups = (await readdir(root)).filter((file) =>
    file.startsWith('state.json.before-profile-overlays-v7-'),
  );
  expect(backups).toHaveLength(1);
  const backup = path.join(root, backups[0]!);
  expect(await readFile(backup)).toEqual(original);
  expect((await stat(backup)).mode & 0o777).toBe(0o600);
});

it('preserves malformed UTF-8 bytes before a version 2 save replaces version 1 state', async () => {
  const storage = new Storage(path.join(root, 'state.json'));
  const original = malformedNameBytes(1);
  await writeFile(storage.file, original);

  const next = state(2, []) as SavedState;
  await storage.save(next);
  expect(JSON.parse(await readFile(storage.file, 'utf8'))).toMatchObject({
    version: 2,
    workspaces: [{ id: 'w', name: 'Work' }],
  });
  const backups = (await readdir(root)).filter((file) =>
    file.startsWith('state.json.before-services-v2-'),
  );
  expect(backups).toHaveLength(1);
  const backup = path.join(root, backups[0]!);
  expect(await readFile(backup)).toEqual(original);
  expect((await stat(backup)).mode & 0o777).toBe(0o600);
});
