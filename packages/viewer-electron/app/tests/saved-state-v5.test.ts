/**
 * SCRATCH PLANES (2026-10-23): saved state version 5 adds the scratch plane and a preview's unsaved
 * edits. A version 4 file is backed up before its first version 5 save, as each format change was.
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Storage } from '../src/desktop/storage';
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

it('is version 5', () => {
  expect(CURRENT_STATE_VERSION).toBe(5);
});
it('backs up a version 4 file before migrating it, leaving the original as it was', async () => {
  const storage = new Storage(path.join(root, 'state.json'));
  const original = JSON.stringify(state(4, []));
  await writeFile(storage.file, original);
  const loaded = (await storage.load()).state!;
  expect(loaded.version).toBe(5);
  expect(await readFile(storage.file, 'utf8')).toBe(original);
  const backup = (await readdir(root)).find((file) => file.includes('before-scratch-v5'))!;
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
