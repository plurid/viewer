import { describe, expect, it } from 'vitest';
import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  DefinedWorkspaces,
  rememberedWorkspaceBytes,
} from '../src/desktop/workspaces/defined-workspaces';
import { temporaryRoot } from '../tools/temporary';
import { sampleDefinition, sampleWorkspace } from './workspace-definition-fixtures';

function workspace(index: number, arrangement = {}) {
  const definition = sampleDefinition('sample/project-' + index);
  return sampleWorkspace('space-' + index, {
    definition: { key: definition.key, basis: definition.basis },
    arrangement,
    panes: [
      {
        id: 'terminal',
        type: 'terminal',
        path: definition.root,
        profileID: 'default',
        definitionPlane: 0,
        startOnOpen: false,
      },
    ],
    roots: ['terminal'],
    activePane: 'terminal',
    tiling: { layout: 'even-horizontal', main: 0.6, panes: ['terminal'] },
  });
}
describe('remembered definition storage', () => {
  it('refuses a snapshot that alone exceeds the memory bound, preserving earlier entries', async () => {
    const root = await temporaryRoot('viewer-defined-memory-oversize-');
    const memory = new DefinedWorkspaces(root);
    await memory.remember(workspace(1), {});
    const before = await readFile(memory.store.file, 'utf8');
    const large = 'x'.repeat(3_900_000);
    await expect(
      memory.remember(workspace(2, { a: large, b: large, c: large, d: large, e: large }), {}),
    ).rejects.toThrow('16 MB');
    expect(await readFile(memory.store.file, 'utf8')).toBe(before);
    expect(memory.get('sample/project-1')).toBeDefined();
  });
  it('persists planes, layout, focus and only its preview positions with mode 0600', async () => {
    const root = await temporaryRoot('viewer-defined-memory-');
    const memory = new DefinedWorkspaces(root);
    const space = workspace(1);
    await memory.remember(space, {
      previewStates: { 'space-1:file': { page: 3 }, 'other:file': { page: 9 } },
      previewHistory: { 'space-1': [] },
    });
    await memory.opened(space.definition!.key);
    const next = new DefinedWorkspaces(root);
    await next.load();
    expect(next.get(space.definition!.key)).toMatchObject({
      workspace: space,
      previewStates: { 'space-1:file': { page: 3 } },
      previewHistory: [],
    });
    expect(next.get(space.definition!.key)!.previewStates).not.toHaveProperty('other:file');
    expect(next.openedAt(space.definition!.key)).toBeGreaterThan(0);
    expect((await stat(memory.store.file)).mode & 0o777).toBe(0o600);
    await next.forget(space.definition!.key);
    expect(next.get(space.definition!.key)).toBeUndefined();
    expect(next.openedAt(space.definition!.key)).toBeGreaterThan(0);
    expect(space.definition).toBeDefined();
  });
  it('keeps the newest 100 and trims oldest snapshots while over 16 MB', async () => {
    const root = await temporaryRoot('viewer-defined-memory-bounds-');
    const memory = new DefinedWorkspaces(root);
    for (let index = 0; index < 101; index++) await memory.remember(workspace(index), {});
    expect(memory.get('sample/project-0')).toBeUndefined();
    expect(memory.get('sample/project-100')).toBeDefined();
    const large = { first: 'x'.repeat(3_000_000), second: 'x'.repeat(3_000_000) };
    for (let index = 101; index < 104; index++) await memory.remember(workspace(index, large), {});
    expect(Buffer.byteLength(await readFile(memory.store.file))).toBeLessThanOrEqual(
      rememberedWorkspaceBytes,
    );
    expect(memory.get('sample/project-101')).toBeUndefined();
    expect(memory.get('sample/project-103')).toBeDefined();
  });
  it('moves an unreadable file aside before writing a new store', async () => {
    const root = await temporaryRoot('viewer-defined-memory-recovery-');
    const file = path.join(root, 'defined-workspaces-v1.json');
    await writeFile(file, '{invalid memory');
    const memory = new DefinedWorkspaces(root);
    await memory.load();
    const kept = (await readdir(root)).find((name) =>
      name.startsWith('defined-workspaces-v1.json.unreadable-'),
    )!;
    expect(await readFile(path.join(root, kept), 'utf8')).toBe('{invalid memory');
    expect(memory.recovery).toContain('kept aside');
    await memory.remember(workspace(1), {});
    expect(JSON.parse(await readFile(file, 'utf8')).closed).toHaveLength(1);
  });
  it('moves a snapshot rejected by the storage workspace schema aside', async () => {
    const root = await temporaryRoot('viewer-defined-memory-validation-');
    const space = workspace(1);
    await writeFile(
      path.join(root, 'defined-workspaces-v1.json'),
      JSON.stringify({
        version: 1,
        opened: {},
        closed: [
          {
            key: space.definition!.key,
            basis: space.definition!.basis,
            at: 1,
            workspace: { ...space, roots: ['missing'] },
            previewStates: {},
            previewHistory: [],
          },
        ],
      }),
    );
    const memory = new DefinedWorkspaces(root);
    await memory.load();
    expect(memory.get(space.definition!.key)).toBeUndefined();
    expect(memory.recovery).toContain('kept aside');
  });
});
