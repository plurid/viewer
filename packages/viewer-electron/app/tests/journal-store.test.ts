import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendFile, lstat, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { JournalStore } from '../src/desktop/journal/store';
import { journalQuerySchema, journalRecordSchema } from '../src/domain/journal/events';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const stores: JournalStore[] = [];
const roots: string[] = [];
async function fixture(limits: Parameters<typeof make>[1] = {}) {
  const root = await temporaryRoot('viewer-journal-');
  roots.push(root);
  return make(path.join(root, 'journal'), limits);
}
function make(directory: string, limits: ConstructorParameters<typeof JournalStore>[2] = {}) {
  const store = new JournalStore(directory, () => {}, limits);
  stores.push(store);
  return store;
}
function record(store: JournalStore, patch: Record<string, unknown> = {}) {
  store.record({
    source: 'git',
    action: 'commit',
    phase: 'succeeded',
    traceID: '10000000-0000-4000-8000-000000000001',
    origin: { workspaceID: 'alpha', planeID: 'folder' },
    ...patch,
  });
}
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  await Promise.all(roots.splice(0).map((root) => trashTemporary(root)));
});

describe('private bounded Journal store', () => {
  it('serializes history review and draining without admitting writes into a closed file', async () => {
    const store = await fixture();
    record(store);
    await store.flush();
    let answer!: (allow: boolean) => void;
    const clearing = store.clear(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    );
    // `clearing` precedes asynchronous handle closure. Join the actual review
    // callback rather than racing it on a busy concurrent native/test run.
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'), { timeout: 5000 });
    record(store);
    await expect(store.clear(async () => false)).rejects.toThrow('busy');
    answer(false);
    expect(await clearing).toBe(false);
    record(store);
    await store.flush();
    const page = await store.query({ filter: {} });
    expect(page.records.map((event) => event.sequence)).toEqual([2, 1]);
    expect(page.status.dropped).toBe(1);
    expect(page.status.state).toBe('ready');
  });
  it('persists an append-only typed history, resumes sequence and returns immutable snapshots', async () => {
    const first = await fixture();
    const origin = { workspaceID: 'alpha', planeID: 'folder' };
    record(first, { origin });
    origin.workspaceID = 'changed';
    await first.flush();
    expect((await lstat(first.file)).mode & 0o077).toBe(0);
    const page = await first.query({ filter: {} });
    expect(page.records[0]?.origin.workspaceID).toBe('alpha');
    page.records[0]!.origin.workspaceID = 'tampered';
    expect((await first.query({ filter: {} })).records[0]?.origin.workspaceID).toBe('alpha');
    await first.close();
    const second = make(path.dirname(first.file));
    record(second, { phase: 'started' });
    await second.flush();
    const restored = await second.query({ filter: {} });
    expect(restored.records.map((event) => event.sequence)).toEqual([2, 1]);
    expect(restored.records[0]?.sessionID).not.toBe(restored.records[1]?.sessionID);
  });

  it('pages a stable snapshot while new events arrive and combines typed filters', async () => {
    const store = await fixture();
    for (let index = 0; index < 5; index += 1)
      record(store, index === 3 ? { phase: 'failed' } : {});
    await store.flush();
    const first = await store.query({ filter: { workspaceID: 'alpha' }, limit: 2 });
    record(store);
    await store.flush();
    const next = await store.query({
      filter: {},
      through: first.through,
      before: first.nextBefore,
      limit: 2,
    });
    expect(first.records.map((event) => event.sequence)).toEqual([5, 4]);
    expect(next.records.map((event) => event.sequence)).toEqual([3, 2]);
    expect(next.matched).toBe(5);
    expect(
      (await store.query({ filter: { level: 'error', search: 'commit' } })).records.map(
        (event) => event.sequence,
      ),
    ).toEqual([4]);
    expect((await store.query({ filter: { planeID: 'other' } })).matched).toBe(0);
    await expect(store.query({ filter: { since: 20, until: 10 } })).rejects.toThrow();
    expect(journalQuerySchema.safeParse({ filter: {}, limit: 100000 }).success).toBe(false);
  });

  it('caps pending and durable records without pruning files or losing the action result', async () => {
    const store = await fixture({ records: 2, pending: 2 });
    for (let index = 0; index < 6; index += 1) record(store);
    await store.flush();
    const before = await readFile(store.file, 'utf8');
    record(store);
    await store.flush();
    const page = await store.query({ filter: {} });
    expect(page.records).toHaveLength(2);
    expect(page.status.state).toBe('full');
    expect(page.status.dropped).toBe(5);
    expect(await readFile(store.file, 'utf8')).toBe(before);
    const tiny = await fixture({ bytes: 32 });
    record(tiny);
    await tiny.flush();
    expect((await tiny.query({ filter: {} })).status.state).toBe('full');
    expect(await readFile(tiny.file, 'utf8')).toBe('');
  });

  it('preserves a torn tail, serves earlier valid rows and refuses further appends', async () => {
    const store = await fixture();
    record(store);
    await store.close();
    await appendFile(store.file, '{"incomplete":');
    const original = await readFile(store.file, 'utf8');
    const restored = make(path.dirname(store.file));
    record(restored);
    await restored.flush();
    const page = await restored.query({ filter: {} });
    expect(page.records).toHaveLength(1);
    expect(page.status.state).toBe('unavailable');
    expect(page.status.dropped).toBe(1);
    expect(await readFile(store.file, 'utf8')).toBe(original);
  });

  it('refuses symbolic links and replacement files and keeps every generated item', async () => {
    const store = await fixture();
    record(store);
    await store.flush();
    await rename(store.file, store.file + '.retained');
    await writeFile(store.file, 'replacement must survive', { mode: 0o600 });
    record(store);
    await store.flush();
    expect((await store.query({ filter: {} })).status.state).toBe('unavailable');
    expect(await readFile(store.file, 'utf8')).toBe('replacement must survive');
    const folder = path.join(path.dirname(store.file), 'linked');
    await mkdir(folder);
    await symlink(store.file, path.join(folder, 'events.jsonl'));
    const linked = make(folder);
    record(linked);
    await linked.flush();
    expect((await linked.query({ filter: {} })).status.state).toBe('unavailable');
    expect(await readFile(store.file, 'utf8')).toBe('replacement must survive');
  });

  it('keeps all history on a cancelled clear and rejects arbitrary secret-bearing fields', async () => {
    const store = await fixture();
    record(store);
    await store.flush();
    const before = await readFile(store.file, 'utf8');
    const review = vi.fn(async () => false);
    expect(await store.clear(review)).toBe(false);
    expect(review).toHaveBeenCalledWith(store.file);
    expect(await readFile(store.file, 'utf8')).toBe(before);
    record(store, { message: 'secret-key-in-provider-error' });
    await store.flush();
    expect(await readFile(store.file, 'utf8')).toBe(before);
    expect((await store.query({ filter: {} })).status.dropped).toBe(1);
    expect(journalRecordSchema.safeParse({ arbitrary: 'secret' }).success).toBe(false);
  });
});
