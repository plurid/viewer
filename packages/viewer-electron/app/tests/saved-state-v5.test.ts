/**
 * SCRATCH PLANES (2026-10-23): saved state version 5 adds the scratch plane and a preview's unsaved
 * edits. A version 4 file is backed up before its first version 5 save, as each format change was.
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Storage } from '../src/desktop/persistence/storage';
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
  expect(CURRENT_STATE_VERSION).toBe(8);
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
