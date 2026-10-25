import { expect, it, vi } from 'vitest';
import { DocumentCache } from '../src/desktop/previews/document-cache';
import type { DocumentData } from '../src/domain/services';
import type { FileEntry } from '../src/domain/contracts';
const value = { text: 'Shared document', truncated: false } as DocumentData;
const inspect = async () => ({ identity: '1:2', modified: 1, size: 10 }) as FileEntry;
it('shares concurrent extraction without allowing one closed view to cancel another', async () => {
  let finish!: (value: DocumentData) => void;
  const decode = vi.fn(
    async () =>
      new Promise<DocumentData>((resolve) => {
        finish = resolve;
      }),
  );
  const cache = new DocumentCache(decode, inspect);
  const first = new AbortController();
  const one = cache.read('/file.docx', undefined, first.signal);
  const denied = expect(one).rejects.toThrow();
  const two = cache.read('/file.docx');
  await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
  first.abort();
  finish(value);
  await denied;
  expect(await two).toBe(value);
  expect(await cache.read('/file.docx')).toBe(value);
  expect(decode).toHaveBeenCalledTimes(1);
});
it('invalidates changed sources and keeps different extraction limits separate', async () => {
  let modified = 1;
  const decode = vi.fn(async () => value);
  const cache = new DocumentCache(decode, async () => ({ ...(await inspect()), modified }));
  await cache.read('/file.pdf', 1);
  await cache.read('/file.pdf', 2);
  expect(decode).toHaveBeenCalledTimes(2);
  modified++;
  await cache.read('/file.pdf', 1);
  expect(decode).toHaveBeenCalledTimes(3);
  cache.invalidate('/file.pdf');
  await cache.read('/file.pdf', 1);
  expect(decode).toHaveBeenCalledTimes(4);
});
