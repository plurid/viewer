import { afterEach, expect, it, vi } from 'vitest';
import type * as FileSystem from 'node:fs/promises';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DefinedWorkspaces } from '../src/desktop/workspaces/defined-workspaces';
import { WorkspaceDefinitions } from '../src/desktop/workspaces/definitions';
import { defaultSettings } from '../src/domain/services';
import { temporaryRoot } from '../tools/temporary';
import { sampleWorkspace } from './workspace-definition-fixtures';

vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof FileSystem>();
  return { ...fs, rename: vi.fn(fs.rename) };
});
afterEach(() => vi.restoreAllMocks());
const basis = 'a'.repeat(64);
const bufferID = '00000000-0000-4000-8000-000000000001';
const space = sampleWorkspace('remembered', {
  definition: { key: 'sample', basis },
  panes: [{ id: 'idea', type: 'scratch', path: '/projects/sample', bufferID }],
  roots: ['idea'],
});

it('never overwrites a retained unreadable file, while fresh definitions still open with a note', async () => {
  const root = await temporaryRoot('viewer-defined-retained-');
  const file = path.join(root, 'defined-workspaces-v1.json');
  await writeFile(file, '{ retained unreadable text');
  vi.mocked(rename).mockRejectedValueOnce(new Error('Keeping the file aside was refused.'));
  const memory = new DefinedWorkspaces(root);
  await memory.load();
  await expect(memory.forget('sample')).rejects.toThrow('remain protected');
  await expect(memory.remember(space, {})).rejects.toThrow('protected');
  expect(await readFile(file, 'utf8')).toBe('{ retained unreadable text');
  await writeFile(
    path.join(root, 'workspaces.jsonc'),
    JSON.stringify({
      version: 1,
      sources: { projectManager: { enabled: false } },
      workspaces: { sample: { root: '/projects/sample' } },
    }),
  );
  const definitions = new WorkspaceDefinitions(root, '/home/sample', {
    memory,
    access: async () => {},
    checkRoot: async () => ({ directory: true }),
    settings: () => defaultSettings('/home/sample'),
    emit: () => {},
  });
  try {
    await definitions.load();
    await expect(definitions.opened('sample')).resolves.toBeUndefined();
    expect(definitions.entry('sample')).toBeDefined();
    expect(definitions.snapshot().diagnostics).toContainEqual(
      expect.objectContaining({
        level: 'note',
        message: expect.stringContaining('will not overwrite'),
      }),
    );
    expect(await readFile(file, 'utf8')).toBe('{ retained unreadable text');
  } finally {
    await definitions.close();
    await memory.close();
  }
});

it('stores preview history and identifies buffers held by remembered snapshots', async () => {
  const root = await temporaryRoot('viewer-defined-memory-history-');
  const history = [{ path: '/projects/sample/readme.pdf', updated: 1, values: { 'pdf.page': 4 } }];
  const memory = new DefinedWorkspaces(root);
  await memory.remember(space, { previewHistory: { [space.id]: history } });
  const next = new DefinedWorkspaces(root);
  await next.load();
  expect(next.get('sample')!.previewHistory).toEqual(history);
  expect(next.bufferIDs()).toEqual([bufferID]);
});

it.each(['key', 'basis'])(
  'rejects a snapshot whose %s disagrees with its workspace link',
  async (field) => {
    const root = await temporaryRoot('viewer-defined-memory-link-');
    const file = path.join(root, 'defined-workspaces-v1.json');
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        opened: {},
        closed: [
          {
            key: 'sample',
            basis,
            at: 1,
            workspace: {
              ...space,
              definition: {
                ...space.definition,
                [field]: field === 'key' ? 'other' : 'b'.repeat(64),
              },
            },
            previewStates: {},
            previewHistory: [],
          },
        ],
      }),
    );
    const memory = new DefinedWorkspaces(root);
    await memory.load();
    expect(memory.get('sample')).toBeUndefined();
    expect(memory.recovery).toContain('kept aside');
  },
);

it('sorts recovered entries by recency before later writes and trimming', async () => {
  const root = await temporaryRoot('viewer-defined-memory-recency-');
  const file = path.join(root, 'defined-workspaces-v1.json');
  const closed = [1, 3, 2].map((at) => ({
    key: 'sample-' + at,
    basis,
    at,
    workspace: { ...space, id: 'workspace-' + at, definition: { key: 'sample-' + at, basis } },
    previewStates: {},
    previewHistory: [],
  }));
  await writeFile(file, JSON.stringify({ version: 1, closed, opened: {} }));
  const memory = new DefinedWorkspaces(root);
  await memory.opened('sample');
  expect(
    JSON.parse(await readFile(file, 'utf8')).closed.map((entry: { at: number }) => entry.at),
  ).toEqual([3, 2, 1]);
});
