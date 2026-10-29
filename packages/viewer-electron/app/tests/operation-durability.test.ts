/**
 * Copying 2,000 small files took 41 seconds: each file paid four disk syncs. An intent is still
 * synced before the change it covers; a record of what is done, and a copy's first intent (its
 * staging folder's intent follows, synced), are written without waiting, as recovery reads
 * either as an interrupted item and changes nothing.
 */
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { OperationLog } from '../src/desktop/operations/operation-journal';
import { Operations } from '../src/desktop/operations/operations';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root = '';
afterEach(async () => {
  vi.restoreAllMocks();
  await trashTemporary(root);
});

it('syncs each staged intent, and leaves completions to the next sync', async () => {
  root = await temporaryRoot('viewer-durability-');
  const sources = path.join(root, 'sources');
  const destination = path.join(root, 'destination');
  const trash = path.join(root, 'trash');
  for (const folder of [sources, destination, trash]) await mkdir(folder);
  const files = ['a.txt', 'b.txt', 'c.txt'].map((name) => path.join(sources, name));
  for (const file of files) await writeFile(file, 'text');
  const appends: { events: string[]; staged: boolean; durable: boolean }[] = [];
  // `append` is the one place log bytes reach disk; the spy records whether each was synced
  type Appending = { append(file: string, text: string, durable?: boolean): Promise<void> };
  const log = OperationLog.prototype as unknown as Appending;
  const append = log.append;
  vi.spyOn(log, 'append').mockImplementation(function (
    this: Appending,
    file: string,
    text: string,
    durable = true,
  ) {
    const events = text
      .trim()
      .split('\n')
      .map((line) => (JSON.parse(line) as { t: string }).t);
    appends.push({ events, staged: text.includes('"staging"'), durable });
    return append.call(this, file, text, durable);
  });
  const operations = new Operations(
    async (file) => rename(file, path.join(trash, path.basename(file))),
    () => {},
    undefined,
    undefined,
    undefined,
    path.join(root, 'data'),
  );
  const id = operations.start({ kind: 'copy', sources: files, destination });
  await vi.waitFor(() =>
    expect(operations.all().find((job) => job.id === id)?.status).toBe('completed'),
  );
  await operations.close();
  const staged = appends.filter((item) => item.staged);
  expect(staged).toHaveLength(files.length);
  expect(staged.every((item) => item.durable)).toBe(true);
  // an item's completion also clears its intent
  const completions = appends.filter((item) => item.events.includes('completed') && !item.staged);
  expect(completions.length).toBeGreaterThan(0);
  expect(completions.every((item) => !item.durable)).toBe(true);
});
