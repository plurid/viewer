import { access, mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { temporaryRoot } from '../tools/temporary';
import { expect, it } from 'vitest';
import { prepareFolderHistory, checkHistoryFolder } from '../src/desktop/files/folder-history';
import { stateSchema } from '../src/desktop/persistence/storage';
import { WorkspaceSessions } from '../src/desktop/windows/workspace-sessions';

it('merges slash and filesystem case aliases, drops legacy file visits and keeps offline folders', async () => {
  const history = {
    '/fixtures/Documents': { count: 3, last: 100 },
    '/fixtures/Documents/': { count: 4, last: 101 },
    '/fixtures/documents': { count: 5, last: 102 },
    '/fixtures/preview.txt': { count: 99, last: 103 },
    '/Volumes/Offline/work': { count: 10, last: 104 },
  };
  const sessions = new WorkspaceSessions();
  const original = sessions.open(1, '/fixtures');
  sessions.close(1);
  const loaded = stateSchema.parse({ ...original, version: 1, visits: history });
  const result = await prepareFolderHistory(
    loaded.visits ?? {},
    async (path) => {
      if (path.startsWith('/Volumes/Offline')) throw new Error('Offline.');
      return {
        path: path.toLowerCase().endsWith('/documents') ? '/fixtures/Documents' : path,
        directory: !path.endsWith('.txt'),
      };
    },
    200,
  );
  expect(result.visits).toEqual({
    '/fixtures/Documents': { count: 12, last: 102 },
    '/Volumes/Offline/work': { count: 10, last: 104 },
  });
  expect(result.checked).toEqual(['/fixtures/Documents']);
  const prepared = new WorkspaceSessions();
  prepared.seed(loaded);
  prepared.seedFolderHistory(result.visits);
  expect(prepared.open(1, '/fixtures').visits).toEqual(result.visits);
});

it('keeps a dangling folder link to an unplugged volume', async () => {
  const root = await temporaryRoot('viewer-offline-link-');
  const link = path.join(root, 'Offline');
  await symlink('/Volumes/Unplugged/Work', link);
  const result = await prepareFolderHistory(
    { [link]: { count: 40, last: 10 } },
    async (file) => checkHistoryFolder(file),
    20,
  );
  expect(result.visits[link]).toEqual({ count: 40, last: 10 });
  expect(result.checked).toEqual([]);
});

it('uses actual filesystem case spelling without folding distinct case-sensitive folders', async () => {
  const root = await temporaryRoot('viewer-history-case-');
  const upper = path.join(root, 'Docs');
  const lower = path.join(root, 'docs');
  await mkdir(upper);
  const actual = path.join(realpathSync.native(root), 'Docs');
  const insensitive = await access(lower).then(
    () => true,
    () => false,
  );
  if (!insensitive) await mkdir(lower);
  if (insensitive) expect(checkHistoryFolder(lower).path).toBe(actual);
  const history = { [upper]: { count: 8, last: 1 }, [lower]: { count: 2, last: 2 } };
  const result = await prepareFolderHistory(history, async (file) => checkHistoryFolder(file), 3);
  expect(Object.keys(result.visits)).toHaveLength(insensitive ? 1 : 2);
  if (insensitive) expect(result.visits[actual]?.count).toBe(10);
  else expect(result.visits).toEqual(history);
});

it('resolves a folder link to its native filesystem spelling', async () => {
  const root = await temporaryRoot('viewer-history-native-');
  const real = path.join(root, 'Real');
  const link = path.join(root, 'Link');
  await mkdir(real);
  await symlink(real, link);
  expect(checkHistoryFolder(link)).toEqual({
    directory: true,
    path: path.join(realpathSync.native(root), 'Real'),
  });
});

it('retains unchecked Store records without treating them as confirmed files or checked folders', async () => {
  const visits = { '/fixtures/Projects': { count: 40, last: 10 } };
  const prepared = await prepareFolderHistory(
    visits,
    async () => ({ directory: false, unchecked: true }),
    20,
  );
  expect(prepared.visits).toEqual(visits);
  expect(prepared.checked).toEqual([]);
  expect(prepared.files).toEqual([]);
});

it('distinguishes a completed missing-folder read from an unchecked Store folder', async () => {
  const root = await temporaryRoot('viewer-history-absent-');
  expect(checkHistoryFolder(path.join(root, 'Gone'))).toMatchObject({
    directory: false,
    unavailable: true,
    missing: true,
  });
});
