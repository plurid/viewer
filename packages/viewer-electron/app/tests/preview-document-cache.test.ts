import { expect, it, vi } from 'vitest';
import {
  PreviewDocumentCache,
  documentServices,
  previewDocuments,
} from '../src/renderer/previews/document-cache';
import type { Resource } from '../src/domain/contracts';
import type { DocumentData } from '../src/domain/services';
import type { PreviewContext } from '../src/renderer/previews/contracts';

const resource = (id: string, modified = 1): Resource => ({
  id,
  url: `viewer-resource://${id}/asset/book.epub`,
  entry: {
    path: '/fixtures/book.epub',
    name: 'book.epub',
    parent: '/fixtures',
    kind: 'file',
    directory: false,
    extension: 'epub',
    mime: 'application/epub+zip',
    identity: 'volume:inode',
    size: 100,
    modified,
    created: 0,
    hidden: false,
  },
});
const data = (text = 'Book'): DocumentData => ({
  path: '/fixtures/book.epub',
  text,
  metadata: {},
  evidence: [],
  truncated: false,
});
const signal = () => new AbortController().signal;

it('reuses completed document data across separately authorized resource leases', async () => {
  previewDocuments.invalidate();
  const document = vi.fn(async () => data());
  const services = { document } as unknown as PreviewContext['services'];
  await documentServices(services, 'workspace', resource('first'), signal()).document('first');
  const reopened = documentServices(services, 'workspace', resource('second'), signal());
  expect(reopened.cachedDocument?.()?.text).toBe('Book');
  expect((await reopened.document('second')).text).toBe('Book');
  expect(document).toHaveBeenCalledTimes(1);
  await documentServices(services, 'workspace', resource('changed', 2), signal()).document(
    'changed',
  );
  expect(document).toHaveBeenCalledTimes(2);
  previewDocuments.invalidate();
});

it('separates worksheets, source rows, workspaces and resolved source versions', () => {
  const cache = new PreviewDocumentCache();
  const first = cache.key('one', resource('lease-one'), { sheet: 'Data', fromRow: 1, limit: 100 });
  expect(cache.key('one', resource('lease-two'), { limit: 100, fromRow: 1, sheet: 'Data' })).toBe(
    first,
  );
  expect(cache.key('two', resource('lease-two'), { sheet: 'Data', fromRow: 1 })).not.toBe(first);
  expect(cache.key('one', resource('lease-two'), { sheet: 'Data', fromRow: 101 })).not.toBe(first);
  expect(cache.key('one', resource('lease-two'), { sheet: 'Other', fromRow: 1 })).not.toBe(first);
  expect(
    cache.key('one', {
      ...resource('link'),
      entry: { ...resource('link').entry, kind: 'symlink' },
    }),
  ).toBeUndefined();
});

it('reuses the reader-selected first worksheet when it is later requested by name', async () => {
  previewDocuments.invalidate();
  const workbook: DocumentData = {
    ...data(),
    office: {
      kind: 'workbook',
      sheets: [],
      formulas: 0,
      missingCached: 0,
      page: { sheet: 'Materials', fromRow: 1, lastRow: 4, limited: false },
    },
  };
  const document = vi.fn(async () => workbook);
  const services = documentServices(
    { document } as unknown as PreviewContext['services'],
    'workspace',
    resource('one'),
    signal(),
  );
  await services.document('one', { fromRow: 1, limit: 100, requestID: 'first' });
  expect(services.cachedDocument?.({ sheet: 'Materials', fromRow: 1, limit: 100 })).toBe(workbook);
  await services.document('one', {
    sheet: 'Materials',
    fromRow: 1,
    limit: 100,
    requestID: 'second',
  });
  expect(document).toHaveBeenCalledTimes(1);
  previewDocuments.invalidate();
});

it('does not retain or publish a late revoked result, while preserving unrelated reads', async () => {
  const cache = new PreviewDocumentCache();
  let finish!: (value: DocumentData) => void;
  const pending = cache.read(
    'one',
    '/revoked/book',
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    signal(),
  );
  const denied = expect(pending).rejects.toThrow('access changed');
  await cache.read('two', '/other/book', async () => data(), signal());
  cache.invalidate('/revoked');
  finish(data());
  await denied;
  expect(cache.get('one')).toBeUndefined();
  expect(cache.get('two')).toBeDefined();
});

it('bounds both count and bytes, refreshes LRU use and ignores aborted results', async () => {
  const cache = new PreviewDocumentCache(2, 1000);
  await cache.read('a', '/a', async () => data(), signal());
  await cache.read('b', '/b', async () => data(), signal());
  cache.get('a');
  await cache.read('c', '/c', async () => data(), signal());
  expect(cache.get('b')).toBeUndefined();
  expect(cache.get('a')).toBeDefined();
  await cache.read('large', '/large', async () => data('x'.repeat(1000)), signal());
  expect(cache.get('large')).toBeUndefined();
  const abort = new AbortController();
  await expect(
    cache.read(
      'aborted',
      '/aborted',
      async () => {
        abort.abort();
        return data();
      },
      abort.signal,
    ),
  ).rejects.toThrow();
  expect(cache.get('aborted')).toBeUndefined();
});

it('purges revoked folder descendants for either platform path separator', async () => {
  const cache = new PreviewDocumentCache();
  await cache.read('windows', 'C:\\Files\\Book.epub', async () => data(), signal());
  await cache.read('other', 'C:\\Other\\Book.epub', async () => data(), signal());
  cache.invalidate('C:\\Files');
  expect(cache.get('windows')).toBeUndefined();
  expect(cache.get('other')).toBeDefined();
});
