import { expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Resources } from '../src/desktop/previews/resources';
import { DerivedPreviews, type Decoder } from '../src/desktop/previews/derived';
import { temporaryRoot } from '../tools/temporary';
import { officeLayoutRequestSchema } from '../src/domain/previews/documents/layout';
import { officeRequestAllowed } from '../src/desktop/previews/office-renderer';
import { officeMain, officeThread } from '../src/desktop/previews/office-page';
import { defaultSettings } from '../src/domain/services';
import { nativeOpening } from '../src/renderer/explorer/opening';
import { officeFormats } from '../src/domain/previews/documents/layout';
import { documentTypes } from '../tools/document-types';
import type { FileEntry } from '../src/domain/contracts';
import type { Source } from '../src/desktop/previews/derived';
import { officeInput } from '../src/desktop/previews/office-input';

vi.mock('electron', () => ({ BrowserWindow: vi.fn(), session: {} }));

it('bounds source reads to the captured size and checks cancellation before allocating decoder work', async () => {
  const read = vi.fn(async (data: Buffer, offset: number, length: number) => {
    data.fill(65, offset, offset + length);
    return { bytesRead: length };
  });
  const source = { info: { size: 4, isFile: () => true }, handle: { read } } as unknown as Source;
  expect((await officeInput(source, new AbortController().signal)).toString()).toBe('AAAA');
  expect(read.mock.calls[0]![2]).toBe(4);
  read.mockClear();
  const abort = new AbortController();
  abort.abort();
  await expect(officeInput(source, abort.signal)).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});

it('opens all six formats in Viewer on new settings and advertises alternate file associations', () => {
  const policy = defaultSettings('/fixture').fileOpening;
  for (const extension of officeFormats)
    expect(nativeOpening({ extension } as FileEntry, policy)).toBe(false);
  const office = documentTypes.find((type) => type.CFBundleTypeName === 'Office document')!;
  expect(office.CFBundleTypeExtensions).toEqual(officeFormats);
  expect(office.LSHandlerRank).toBe('Alternate');
});

it('shares exact-source Office bytes, separates sheets, and releases children with their source', async () => {
  const root = await temporaryRoot('viewer-office-layout-');
  const file = path.join(root, 'Legacy.xls');
  await writeFile(file, 'owned workbook fixture');
  const access = vi.fn(async () => {});
  const decode = vi.fn<Decoder>(async (_source, _mode, _signal, _size, sheet) => ({
    data: Buffer.from('%PDF-1.7\nfixture'),
    extension: 'pdf' as const,
    kind: 'office' as const,
    decoder: 'fixture',
    office: {
      sheets: [
        { name: 'Budget', hidden: false },
        { name: 'Notes', hidden: false },
      ],
      selectedSheet: sheet || 'Budget',
      limited: false,
    },
  }));
  const office = new DerivedPreviews(access, decode);
  const resources = new Resources(access, undefined, 12000, undefined, undefined, office);
  try {
    const source = await resources.grant(file);
    const first = await resources.officeLayout(source.id, { requestID: 'one' });
    const warm = await resources.officeLayout(source.id, { requestID: 'two' });
    expect(decode).toHaveBeenCalledTimes(1);
    expect(first.office?.selectedSheet).toBe('Budget');
    const notes = await resources.officeLayout(source.id, { requestID: 'three', sheet: 'Notes' });
    expect(notes.office?.selectedSheet).toBe('Notes');
    expect(decode).toHaveBeenCalledTimes(2);
    expect(access.mock.calls.length).toBeGreaterThan(6);
    resources.release(source.id);
    await expect(resources.read(first.id)).rejects.toThrow('expired');
    await expect(resources.read(warm.id)).rejects.toThrow('expired');
    await expect(resources.read(notes.id)).rejects.toThrow('expired');
  } finally {
    await resources.close();
  }
});

it('permits only the current helper origin and its owned blob workers', () => {
  const origin = 'http://127.0.0.1:41321';
  expect(officeRequestAllowed(origin + '/nonce/soffice.wasm', origin)).toBe(true);
  expect(officeRequestAllowed('blob:' + origin + '/worker', origin)).toBe(true);
  for (const url of [
    'file:///secret.doc',
    'viewer-app://app/',
    'viewer-resource://other/asset',
    'https://example.com/track',
    'http://127.0.0.1:41322/',
    'blob:http://127.0.0.1:41322/worker',
    'data:text/javascript,fetch("https://example.com")',
  ])
    expect(officeRequestAllowed(url, origin)).toBe(false);
  expect(officeThread).toContain('MacroExecMode.NEVER_EXECUTE');
  expect(officeThread).toContain('UpdateDocMode.NO_UPDATE');
  expect(officeMain).not.toContain('window.viewer');
  expect(officeLayoutRequestSchema.safeParse({ requestID: 'one', sheet: 'Notes\0' }).success).toBe(
    false,
  );
  expect(
    officeLayoutRequestSchema.safeParse({ requestID: 'one', path: '/not-an-authority' }).success,
  ).toBe(false);
});
