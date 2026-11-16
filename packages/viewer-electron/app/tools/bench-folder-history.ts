import { performance } from 'node:perf_hooks';
import { WorkspaceSessions } from '../src/desktop/windows/workspace-sessions';
import { FolderVisitSync } from '../src/renderer/state/folder-visits';
import type { FolderVisits } from '../src/domain/files/folder-visits';

const visits: FolderVisits = Object.fromEntries(
  Array.from({ length: 500 }, (_, index) => [`/fixtures/a/${index}`, { count: 10, last: 1000 }]),
);
for (const batches of [1000, 5000]) {
  const sessions = new WorkspaceSessions();
  const first = sessions.create('/fixtures');
  const second = sessions.create('/fixtures');
  const seed = sessions.open(1, '/fixtures', first);
  seed.visits = structuredClone(visits);
  sessions.save(1, seed, { id: 'seed', base: {}, clear: false, revision: 0 });
  const late = sessions.open(2, '/fixtures', second);
  late.visits!['/fixtures/a/0']!.count++;
  for (let index = 0; index < batches; index++)
    sessions.remapFolderHistory([
      {
        source: `/fixtures/${index % 2 ? 'b' : 'a'}`,
        destination: `/fixtures/${index % 2 ? 'a' : 'b'}`,
      },
    ]);
  const start = performance.now();
  let refreshed = false;
  try {
    sessions.save(2, late, { id: 'late', base: visits, clear: false, revision: 0 });
  } catch (error) {
    if ((error as { code?: string }).code !== 'FOLDER_HISTORY_REFRESH') throw error;
    refreshed = true;
  }
  console.log(
    JSON.stringify({
      batches,
      saveMilliseconds: Number((performance.now() - start).toFixed(3)),
      refreshed,
    }),
  );
  if (refreshed) {
    const history = sessions.folderHistory();
    const retry = performance.now();
    const merged = sessions.save(2, late, {
      id: 'retry',
      base: history.visits,
      clear: false,
      revision: history.revision,
    });
    if (merged.visits?.['/fixtures/a/0']?.count !== 11)
      throw new Error('The refreshed save lost a visit.');
    console.log(
      JSON.stringify({
        batches,
        retryMilliseconds: Number((performance.now() - retry).toFixed(3)),
      }),
    );
  }
}
for (const windows of [1, 8]) {
  const readers = Array.from({ length: windows }, () => {
    const sync = new FolderVisitSync();
    sync.reset(visits);
    return sync;
  });
  const start = performance.now();
  for (let index = 0; index < 1000; index++)
    for (const reader of readers)
      reader.remap([
        { source: `/fixtures/unrelated/${index}`, destination: `/fixtures/moved/${index}` },
      ]);
  console.log(
    JSON.stringify({
      windows,
      movedItems: 1000,
      milliseconds: Number((performance.now() - start).toFixed(3)),
    }),
  );
}
