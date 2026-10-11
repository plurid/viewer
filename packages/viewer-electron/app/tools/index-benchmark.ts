/** Synthetic index benchmark; never crawls or reads a user's filesystem. */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { FileIndex } from '../src/desktop/index-core';
import type { FileEntry } from '../src/domain/contracts';
const root = await mkdtemp(path.join(os.tmpdir(), 'viewer-index-benchmark-'));
const size = Math.min(1000000, Math.max(100, Number(process.argv[2] || 100000)));
const index = await FileIndex.open(path.join(root, 'index.sqlite'));
try {
  index.configure({ roots: ['/fixtures'], exclusions: [], contentRoots: [], paused: true });
  await index.settled();
  const start = performance.now();
  for (let base = 0; base < size; base += 1000) {
    const entries: FileEntry[] = Array.from(
      { length: Math.min(1000, size - base) },
      (_, offset) => {
        const i = base + offset;
        const name =
          (i % 100 === 0 ? 'Rehder fire ' : 'Document ') +
          String(i).padStart(7, '0') +
          (i % 3 === 0 ? '.epub' : '.pdf');
        return {
          name,
          path: '/fixtures/Books/' + name,
          parent: '/fixtures/Books',
          kind: 'file',
          directory: false,
          extension: i % 3 === 0 ? 'epub' : 'pdf',
          size: i * 30,
          modified: 1700000000000 + i,
          created: 1600000000000,
          hidden: false,
          mime: 'application/pdf',
          identity: 'fixture:' + i,
        };
      },
    );
    index.ingest(entries, '/fixtures');
  }
  const ingestion = performance.now() - start;
  const samples: number[] = [];
  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    const result = index.query({
      query: i % 2 ? 'fire ext:epub' : 'Document ext:pdf size:>1mb',
      root: '/fixtures/Books',
    });
    if (!result.entries.length && size >= 100000) throw new Error('Expected indexed records');
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      records: index.status().count,
      ingestionMs: Math.round(ingestion),
      queryP50Ms: +samples[15].toFixed(2),
      queryP95Ms: +samples[28].toFixed(2),
      fixture: 'synthetic metadata, disk SQLite/WAL, no filesystem crawl',
    }),
  );
} finally {
  await index.close();
  await rm(root, { recursive: true, force: true });
}
