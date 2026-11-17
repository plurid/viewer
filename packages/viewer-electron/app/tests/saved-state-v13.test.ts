import { describe, expect, it } from 'vitest';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { temporaryRoot } from '../tools/temporary';
import { CURRENT_STATE_VERSION } from '../src/domain/contracts';
import type { SavedState } from '../src/domain/contracts';
import { Storage, stateSchema } from '../src/desktop/persistence/storage';
import { backupIdentityMap, restoreBackupState } from '../src/desktop/persistence/backup-state';
import { sampleWorkspace } from './workspace-definition-fixtures';

const saved = (): SavedState => ({
  version: 12,
  activeWorkspace: 'workspace',
  workspaces: [sampleWorkspace('workspace')],
  favorites: [],
  recents: [],
  look: 'dark',
});
describe('workspace definition state v13', () => {
  it('drops later duplicate definition links on load while retaining every workspace and the original bytes', async () => {
    const root = await temporaryRoot('viewer-state-duplicate-links-');
    const storage = new Storage(path.join(root, 'state.json'));
    const state = saved();
    state.version = CURRENT_STATE_VERSION;
    state.workspaces = ['first', 'second'].map((id) =>
      sampleWorkspace(id, {
        definition: { key: 'sample/site', basis: 'a'.repeat(64) },
        panes: [
          {
            id: `${id}-terminal`,
            type: 'terminal',
            path: '/projects/sample',
            profileID: 'login',
            definitionPlane: 1,
            startOnOpen: false,
          },
        ],
      }),
    );
    state.activeWorkspace = 'first';
    const bytes = JSON.stringify(state);
    await writeFile(storage.file, bytes);
    const restored = (await storage.load()).state!;
    expect(restored.workspaces).toHaveLength(2);
    expect(restored.workspaces[0]!.definition).toBeDefined();
    expect(restored.workspaces[1]!.definition).toBeUndefined();
    expect(restored.workspaces[0]!.panes[0]).toHaveProperty('definitionPlane', 1);
    expect(restored.workspaces[1]!.panes[0]).not.toHaveProperty('definitionPlane');
    expect(await readFile(storage.file, 'utf8')).toBe(bytes);
  });
  it('preserves the exact v12 bytes in a private backup before any migrated save', async () => {
    const root = await temporaryRoot('viewer-state-v13-');
    const storage = new Storage(path.join(root, 'state.json'));
    const bytes = JSON.stringify(saved(), null, 2);
    await writeFile(storage.file, bytes);
    const loaded = await storage.load();
    expect(loaded.recovery).toBeUndefined();
    expect(loaded.state!.version).toBe(13);
    expect(await readFile(storage.file, 'utf8')).toBe(bytes);
    const backup = (await readdir(root)).find((file) =>
      file.includes('.before-workspace-definitions-v13'),
    )!;
    expect(backup).toBeDefined();
    expect(await readFile(path.join(root, backup), 'utf8')).toBe(bytes);
    await storage.save(loaded.state!);
    expect(JSON.parse(await readFile(storage.file, 'utf8')).version).toBe(CURRENT_STATE_VERSION);
    expect(await readFile(path.join(root, backup), 'utf8')).toBe(bytes);
  });
  it('round trips definition metadata and refuses invalid keys, hashes and plane indexes', () => {
    const state = saved();
    state.version = 13;
    state.workspaces[0]!.definition = { key: 'sample/site', basis: 'a'.repeat(64) };
    state.workspaces[0]!.panes = [
      {
        id: 'terminal',
        type: 'terminal',
        path: '/project',
        profileID: 'login',
        definitionPlane: 2,
        startOnOpen: false,
      },
    ];
    state.workspaces[0]!.roots = ['terminal'];
    expect(stateSchema.parse(state).workspaces[0]).toMatchObject(state.workspaces[0]!);
    for (const association of [
      { key: '../bad', basis: 'a'.repeat(64) },
      { key: 'sample', basis: 'bad' },
    ]) {
      expect(
        stateSchema.safeParse({
          ...state,
          workspaces: [{ ...state.workspaces[0]!, definition: association }],
        }).success,
      ).toBe(false);
    }
    expect(
      stateSchema.safeParse({
        ...state,
        workspaces: [
          {
            ...state.workspaces[0]!,
            panes: [{ ...state.workspaces[0]!.panes[0]!, definitionPlane: 30 }],
          },
        ],
      }).success,
    ).toBe(false);
  });
  it('refuses a future version without rewriting its bytes', async () => {
    const root = await temporaryRoot('viewer-state-v13-newer-');
    const storage = new Storage(path.join(root, 'state.json'));
    const bytes = JSON.stringify({ ...saved(), version: 14 });
    await writeFile(storage.file, bytes);
    const loaded = await storage.load();
    expect(loaded.state).toBeNull();
    expect(loaded.recovery).toContain('newer Viewer');
    expect(await readFile(storage.file, 'utf8')).toBe(bytes);
  });
  it('restores backup copies as ad-hoc workspaces and stopped terminals', () => {
    const state = saved();
    state.workspaces[0]!.definition = { key: 'sample/site', basis: 'a'.repeat(64) };
    state.workspaces[0]!.panes = [
      {
        id: 'terminal',
        type: 'terminal',
        path: '/project',
        profileID: 'login',
        definitionPlane: 2,
      },
    ];
    const restored = restoreBackupState(state, backupIdentityMap(state, []), []);
    expect(restored.workspaces[0]!.definition).toBeUndefined();
    expect(restored.workspaces[0]!.panes[0]).toMatchObject({
      type: 'terminal',
      startOnOpen: false,
    });
    expect(
      'definitionPlane' in restored.workspaces[0]!.panes[0]! &&
        restored.workspaces[0]!.panes[0]!.definitionPlane,
    ).toBeUndefined();
  });
});
