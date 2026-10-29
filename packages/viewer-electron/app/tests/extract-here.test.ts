// @vitest-environment jsdom
/**
 * Extract here needs a destination. Search results have no folder of their own, so extracting from
 * them failed with "Choose a destination folder"; each archive now extracts beside itself.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { FileEntry } from '../src/domain/contracts';
import { folderCommands, type FolderActions } from '../src/renderer/commands/folder';
import type { CommandContext } from '../src/renderer/commands/registry';
import { initialize } from '../src/renderer/state/store';

const archive = (parent: string, name: string): FileEntry => ({
  path: parent + '/' + name,
  parent,
  name,
  extension: name.split('.').pop()!,
  kind: 'file',
  directory: false,
  size: 10,
  modified: 1,
  created: 1,
  hidden: false,
  mime: 'application/zip',
  identity: name,
});
const operate = vi.fn(async () => 'job');
Object.assign(window, { viewer: { operate } });
afterEach(() => operate.mockClear());
initialize({ home: '/Users/a', platform: 'darwin', state: null, locations: [], openPaths: [] });

const extract = folderCommands(new Proxy({}, { get: () => vi.fn() }) as FolderActions).find(
  (command) => command.id === 'extract',
)!;
const context = (selection: FileEntry[], directory?: string): CommandContext => ({
  scope: 'files',
  workspaceID: 'w',
  selection,
  directory,
  clipboard: null,
  jobs: [],
});

it('extracts into the folder in view', async () => {
  const files = [archive('/Downloads', 'a.zip'), archive('/Downloads', 'b.tar')];
  expect(extract.label).toBe('Extract here');
  await extract.run(context(files, '/Downloads'));
  expect(operate).toHaveBeenCalledOnce();
  expect(operate).toHaveBeenCalledWith({
    kind: 'extract',
    sources: ['/Downloads/a.zip', '/Downloads/b.tar'],
    destination: '/Downloads',
  });
});

it('extracts search results beside each archive', async () => {
  const files = [archive('/Downloads', 'a.zip'), archive('/Desktop', 'b.zip')];
  await extract.run(context(files));
  expect(operate.mock.calls).toEqual([
    [{ kind: 'extract', sources: ['/Downloads/a.zip'], destination: '/Downloads' }],
    [{ kind: 'extract', sources: ['/Desktop/b.zip'], destination: '/Desktop' }],
  ]);
});
