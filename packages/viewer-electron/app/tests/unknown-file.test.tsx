// @vitest-environment jsdom
/**
 * A file no preview reads: Viewer names it from its first bytes, shows it in place with the
 * preview that reads such bytes, and asks the prompt model only when the person asks.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FileEntry, Resource } from '../src/domain/contracts';
import type { FileGuess } from '../src/domain/files/file-guess';
import type { SQLiteReply, SQLiteRequest } from '../src/domain/previews/data/sqlite';
import type { FileServices } from '../src/desktop/files/file-services';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import TextPreview from '../src/renderer/previews/modules/TextPreview';
import { getState, initialize, receiveSettings } from '../src/renderer/state/store';
import { newModelProvider } from '../src/domain/models/providers';
import { Resources } from '../src/desktop/previews/resources';
import { DocumentCache } from '../src/desktop/previews/document-cache';
import { createResourceHandlers } from '../src/desktop/ipc/resource-handlers';
import { schemas } from '../src/desktop/ipc/schemas';
import { documentSamples, office } from '../tools/playground/samples/documents';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import { mockElementBox } from './support/layout';

vi.mock('@tanstack/react-virtual', () => ({
  defaultRangeExtractor: () => [],
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize(): number }) => ({
    measure: () => {},
    measureElement: () => {},
    scrollToIndex: () => {},
    getTotalSize: () => count * estimateSize(),
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * estimateSize(),
        size: estimateSize(),
      })),
  }),
}));

const viewer = {
  identifyFile: vi.fn<(file: string) => Promise<FileGuess>>(),
  resourceFormat: vi.fn<(id: string, extension: string) => Promise<Resource>>(),
  openSettings: vi.fn(async () => {}),
  openExternal: vi.fn(async () => {}),
  nativeFilePanel: vi.fn(async () => {}),
  onEvent: vi.fn(() => () => {}),
  save: vi.fn(async () => {}),
};
const database: SQLiteReply = {
  kind: 'tables',
  version: '1:1',
  objects: [
    {
      name: 'materials',
      kind: 'table',
      columns: [{ name: 'name', type: 'TEXT', notNull: false, primaryKey: 0 }],
      columnCount: 1,
      count: { kind: 'exact', rows: 0 },
      definition: 'CREATE TABLE materials(name TEXT)',
    },
  ],
  limited: false,
  wal: false,
};
let sqliteHead: Uint8Array<ArrayBuffer>;
let served: Uint8Array<ArrayBuffer>;
const fetched = vi.fn(async (_url: string, _init?: RequestInit) => new Response(served));

beforeAll(async () => {
  // the text view reads the editor's font settings
  initialize({ home: '/fixtures', platform: 'darwin', locations: [], state: null, openPaths: [] });
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ width: 800, height: 800, top: 0, left: 0, right: 800, bottom: 800, x: 0, y: 0 }) as DOMRect;
  mockElementBox(800, 800);
  // jsdom's URL is not Node's: the path is built from the module's own
  const library = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../tools/playground/assets/library.sqlite',
  );
  sqliteHead = new Uint8Array((await readFile(library)).subarray(0, 4096));
});
beforeEach(() => {
  for (const method of Object.values(viewer)) method.mockClear();
  Object.assign(window, { viewer });
  vi.stubGlobal('fetch', fetched);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  fetched.mockClear();
  served = sqliteHead;
  setProviders([]);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setProviders(providers: ReturnType<typeof newModelProvider>[]) {
  const snapshot = structuredClone(getState().settings);
  snapshot.revision++;
  snapshot.settings.providers = providers;
  act(() => receiveSettings(snapshot));
}
function preview(name = 'Untitled') {
  const values = new Map<string, unknown>();
  const sqlite = vi.fn(async (_id: string, _request: SQLiteRequest) => database);
  const entry = {
    path: `/fixtures/${name}`,
    name,
    parent: '/fixtures',
    extension: name.includes('.') ? name.split('.').pop()! : '',
    mime: 'application/octet-stream',
    size: 16384,
    kind: 'file',
    directory: false,
    identity: '1:1',
    modified: 1,
    created: 1,
    hidden: false,
  } as FileEntry;
  const context = {
    resource: { id: 'resource', entry, url: `viewer-resource://resource/asset/${name}` },
    active: true,
    interactive: true,
    look: 'dark',
    signal: new AbortController().signal,
    state: {
      get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => values.set(key, value),
    },
    services: {
      read: async () => ({ text: '', binary: true, truncated: false }),
      sqlite,
    },
  } as unknown as PreviewContext;
  return { view: render(<TextPreview {...context} />), sqlite };
}

describe('a file no preview reads', () => {
  it('names a misnamed database from its first bytes and shows it as one', async () => {
    const { view, sqlite } = preview('library.dat');
    expect(await view.findByText('Looks like a SQLite database')).toBeTruthy();
    expect(fetched).toHaveBeenCalledWith(
      'viewer-resource://resource/asset/library.dat',
      expect.objectContaining({ headers: { Range: 'bytes=0-4095' } }),
    );
    expect(view.getByRole('button', { name: 'Quick Look in macOS' })).toBeTruthy();
    expect(view.getByRole('button', { name: 'Open in Default App' })).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Show as SQLite database' }));
    const tables = await view.findByRole('navigation', { name: 'Tables and views' });
    expect(tables.textContent).toContain('materials');
    expect(sqlite).toHaveBeenCalledWith('resource', { kind: 'tables' });
  });

  it('names a format whose preview needs its name, without offering to show it', async () => {
    // a TIFF header whose bytes 8 and 9 say Canon RAW
    served = new Uint8Array([0x49, 0x49, 0x2a, 0, 0x10, 0, 0, 0, 0x43, 0x52, 2, 0, ...Array(52)]);
    const { view } = preview();
    expect(await view.findByText('Looks like a Canon RAW image')).toBeTruthy();
    expect(view.getByText('Viewer previews it when its name ends in .cr2.')).toBeTruthy();
    expect(view.queryByRole('button', { name: /^Show as/ })).toBeNull();
  });

  it('keeps Preview unavailable for bytes it cannot name, and asks no model unless one is set up', async () => {
    served = new Uint8Array([0x13, 0x37, 0, 0, 0x42]);
    const { view } = preview();
    await waitFor(() => expect(fetched).toHaveBeenCalled());
    expect(view.getByText('Preview unavailable')).toBeTruthy();
    expect(view.queryByRole('button', { name: /^Ask/ })).toBeNull();
  });
});

describe('asking the prompt model', () => {
  const provider = { ...newModelProvider('local', 'fixture'), name: 'Studio model' };
  beforeEach(() => {
    served = new Uint8Array([0x13, 0x37, 0, 0, 0x42]);
    setProviders([provider]);
  });

  it('shows the answer as the provider’s proposal, and shows a format it names', async () => {
    viewer.identifyFile.mockResolvedValue({
      provider: 'Studio model',
      kind: 'Encrypted SQLite database',
      extension: 'sqlite',
      apps: ['DB Browser for SQLite'],
      note: 'The header may be encrypted.',
    });
    const { view, sqlite } = preview();
    fireEvent.click(await view.findByRole('button', { name: 'Ask Studio model' }));
    expect(viewer.identifyFile).toHaveBeenCalledWith('/fixtures/Untitled');
    expect((await view.findByRole('status')).textContent).toBe(
      'Studio model suggests: Encrypted SQLite database (.sqlite). Opens in DB Browser for SQLite. The header may be encrypted.',
    );
    fireEvent.click(view.getByRole('button', { name: 'Show as Encrypted SQLite database' }));
    await view.findByRole('navigation', { name: 'Tables and views' });
    expect(sqlite).toHaveBeenCalled();
  });

  it('shows a refusal with the way to Settings', async () => {
    // as the renderer's API boundary restores a refusal: an Error with its code
    viewer.identifyFile.mockRejectedValue(
      Object.assign(
        new Error('Allow this provider to receive the selected data before running the action.'),
        { code: 'MODEL_DATA_PERMISSION_REQUIRED' },
      ),
    );
    const { view } = preview();
    fireEvent.click(await view.findByRole('button', { name: 'Ask Studio model' }));
    expect((await view.findByRole('alert')).textContent).toMatch(/Allow this provider/);
    fireEvent.click(view.getByRole('button', { name: 'Review in Settings' }));
    expect(viewer.openSettings).toHaveBeenCalledWith('settings.providers');
    expect(screen.getByRole('button', { name: 'Ask again' })).toBeTruthy();
  });
});

/** The desktop service reads these formats by extension: Show as has it confirm the format from
 * the file's own bytes, here a real preview resource and the handlers that read it. */
describe('a format the desktop service reads by its extension', () => {
  let root: string, resources: Resources;
  beforeEach(async () => {
    root = await temporaryRoot('viewer-show-as-preview-');
    resources = new Resources();
    viewer.resourceFormat.mockImplementation((id, extension) =>
      resources.confirmFormat(id, extension),
    );
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  });
  afterEach(async () => {
    viewer.resourceFormat.mockReset();
    await resources.close();
    await trashTemporary(root);
  });
  /** `head`: the bytes the preview reads to name the file, the file's own unless given. */
  async function preview(name: string, bytes: Uint8Array, head = bytes) {
    await writeFile(path.join(root, name), bytes);
    const resource = await resources.grant(path.join(root, name));
    served = new Uint8Array(head.subarray(0, 4096));
    const documents = new DocumentCache();
    const extract: FileServices['extract'] = (file, signal, _chapters, worksheet, format) =>
      documents.read(file, undefined, signal, worksheet, format);
    const handlers = createResourceHandlers({
      resources,
      thumbnails: { get: vi.fn() },
      webPreviews: { releaseResource: vi.fn() },
      files: { extract },
      fileAccess: { require: vi.fn() },
      forgetGitResource: vi.fn(),
      warmOffice: vi.fn(),
    });
    const values = new Map<string, unknown>();
    const context = {
      resource,
      active: true,
      interactive: true,
      look: 'dark',
      signal: new AbortController().signal,
      state: {
        get: (key: string) => values.get(key),
        set: (key: string, value: unknown) => values.set(key, value),
      },
      services: {
        read: (id: string, limit?: number) => resources.read(id, limit),
        document: (id: string, request?: object) =>
          handlers.document(schemas.document.parse(request ? [id, request] : [id]), 1),
        cancelDocument: async (id: string, requestID: string) =>
          resources.cancelDocument(id, requestID),
        archiveEntry: (id: string, entry: string) => resources.archiveEntry(id, entry),
        release: async (id: string) => resources.release(id),
      },
    } as unknown as PreviewContext;
    return { view: render(<TextPreview {...context} />), resource };
  }
  const book = async () =>
    documentSamples(new Uint8Array()).find((sample) => sample.path.endsWith('.epub'))!
      .bytes as Uint8Array;

  it('shows a misnamed EPUB once the desktop service confirms it from the bytes', async () => {
    const { view, resource } = await preview('Field notes.bin', await book());
    fireEvent.click(await view.findByRole('button', { name: 'Show as EPUB book' }));
    expect(await view.findByRole('heading', { name: 'Look around' })).toBeTruthy();
    expect(viewer.resourceFormat).toHaveBeenCalledWith(resource.id, 'epub');
  });

  it('shows a misnamed Word document in its reading view', async () => {
    const { view, resource } = await preview('Materials', office('docx'));
    fireEvent.click(await view.findByRole('button', { name: 'Show as Word document' }));
    expect(await view.findByText('Field notes: a spatial workbench')).toBeTruthy();
    expect(viewer.resourceFormat).toHaveBeenCalledWith(resource.id, 'docx');
  });

  it('refuses a format the file’s own bytes do not say, whatever head the renderer saw', async () => {
    const { view } = await preview('Notes', new Uint8Array([0x13, 0x37, 0, 0, 0x42]), await book());
    fireEvent.click(await view.findByRole('button', { name: 'Show as EPUB book' }));
    expect((await view.findByRole('alert')).textContent).toBe(
      'The contents of this file do not match .epub.',
    );
    expect(view.getByText('Looks like an EPUB book')).toBeTruthy();
  });
});
