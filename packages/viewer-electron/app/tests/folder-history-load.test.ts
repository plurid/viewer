import { expect, it } from 'vitest';
import { prepareFolderHistory } from '../src/desktop/files/folder-history';
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
