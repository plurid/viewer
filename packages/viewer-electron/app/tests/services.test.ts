import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, rename } from 'node:fs/promises';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { SettingsService } from '../src/desktop/settings';
import { FileIndex } from '../src/desktop/index-core';
import { defaultSettings } from '../src/domain/services';
import { normalizePreferences } from '../src/domain/preferences';
import { extractDocument, localBookFields } from '../src/desktop/formats';
import { Credentials, Providers } from '../src/desktop/providers';
import { imageDimensions } from '../src/desktop/image-dimensions';
import { imageFixture } from './media-fixtures';
import { entry } from '../src/desktop/filesystem';
import type { FileEntry } from '../src/domain/contracts';
import { shortcutKey, matchesShortcut } from '../src/domain/shortcuts';
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'viewer-services-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
export function epubFixture() {
  return Buffer.from(
    zipSync({
      mimetype: strToU8('application/epub+zip'),
      'META-INF/container.xml': strToU8(
        '<container><rootfiles><rootfile full-path="Book/package.opf"/></rootfiles></container>',
      ),
      'Book/package.opf': strToU8(
        '<package><metadata><dc:title>The mastery and uses of fire in antiquity</dc:title><dc:creator>John E. Rehder</dc:creator><dc:publisher>McGill-Queen’s University Press</dc:publisher><dc:date>2000-01-01</dc:date></metadata><manifest><item id="first" href="first.xhtml"/></manifest><spine><itemref idref="first"/></spine></package>',
      ),
      'Book/first.xhtml': strToU8(
        '<html><head><script>forbidden</script></head><body><h1>Fire in antiquity</h1><p>The publication excerpt.</p></body></html>',
      ),
    }),
  );
}
describe('authoritative settings', () => {
  it('merges independent window edits and rejects stale overlapping edits', async () => {
    const settings = new SettingsService(
      root,
      root,
      () => true,
      () => {},
    );
    await settings.load({
      look: 'light',
      ui: normalizePreferences({ version: 2, space: { minimap: false } }),
    });
    expect(settings.snapshot().ui.space.minimap).toBe(false);
    await settings.patch([{ path: 'settings.browsing.density', value: 'compact' }], 0);
    await settings.patch([{ path: 'ui.space.viewcube', value: false }], 0);
    await expect(
      settings.patch([{ path: 'settings.browsing', value: defaultSettings(root).browsing }], 0),
    ).rejects.toThrow('another window');
    const loaded = new SettingsService(
      root,
      root,
      () => false,
      () => {},
    );
    await loaded.load();
    expect(loaded.snapshot().settings.browsing.density).toBe('compact');
    expect(loaded.snapshot().look).toBe('light');
  });
  it('rejects invalid shortcuts, duplicate default bindings, unsafe URLs and template fields', async () => {
    const settings = new SettingsService(
      root,
      root,
      () => true,
      () => {},
    );
    await expect(
      settings.patch([{ path: 'settings.shortcuts', value: { palette: 'Cmd+F' } }], 0),
    ).rejects.toThrow();
    await expect(
      settings.patch([{ path: 'settings.shortcuts', value: { palette: 'Space' } }], 0),
    ).rejects.toThrow();
    await expect(
      settings.patch([{ path: 'settings.__proto__.value', value: true }], 0),
    ).rejects.toThrow('Unknown');
    await expect(
      settings.patch(
        [
          {
            path: 'settings.providers',
            value: [
              {
                id: 'p',
                name: 'P',
                kind: 'local',
                endpoint: 'http://example.com/v1',
                model: 'm',
                allowContent: false,
              },
            ],
          },
        ],
        0,
      ),
    ).rejects.toThrow();
    await expect(
      settings.patch(
        [
          {
            path: 'settings.recipes',
            value: [{ ...defaultSettings(root).recipes[0], template: '{unknown}' }],
          },
        ],
        0,
      ),
    ).rejects.toThrow('unknown field');
    expect(shortcutKey('Control+Shift+A')).toBe(shortcutKey('Shift+Ctrl+a'));
    expect(
      matchesShortcut('Cmd+Shift+R', {
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
        key: 'R',
      }),
    ).toBe(true);
  });
});
describe('background filename and metadata index', () => {
  it('keeps direct-folder scope distinct and reconciles old FTS row ownership', async () => {
    const file = path.join(root, 'old-index.sqlite');
    const old = new DatabaseSync(file);
    old.exec(
      "CREATE TABLE files(path TEXT PRIMARY KEY,root TEXT,name TEXT,extension TEXT,size INTEGER,modified REAL,hidden INTEGER,directory INTEGER,data TEXT,seen INTEGER); CREATE VIRTUAL TABLE names USING fts5(name,content,path UNINDEXED,tokenize='trigram');",
    );
    const sample = {
      name: 'Book.txt',
      path: '/fixtures/Book.txt',
      parent: '/fixtures',
      directory: false,
      extension: 'txt',
      size: 100,
      modified: 1,
      created: 1,
      identity: 'fixture:10',
      kind: 'file' as const,
      mime: 'text/plain',
      hidden: false,
    };
    old
      .prepare('INSERT INTO files(rowid,path,root,name,data,hidden) VALUES(10,?,?,?,?,0)')
      .run(sample.path, '/fixtures', 'book.txt', JSON.stringify(sample));
    old
      .prepare('INSERT INTO names(rowid,name,content,path) VALUES(1,?,?,?)')
      .run('book.txt', 'local marker', sample.path);
    old.close();
    const index = await FileIndex.open(file);
    try {
      index.configure({
        roots: ['/fixtures'],
        exclusions: [],
        contentRoots: ['/fixtures'],
        paused: true,
      });
      await index.settled();
      expect(index.query({ query: 'marker', content: true }).entries[0]?.path).toBe(sample.path);
      index.put(
        { ...sample, path: '/fixtures/Sub/Book.txt', parent: '/fixtures/Sub' } as FileEntry,
        '/fixtures',
      );
      expect(
        index
          .query({ query: 'book', root: '/fixtures', recursive: false })
          .entries.map((entry) => entry.path),
      ).toEqual([sample.path]);
      expect(index.query({ query: 'book', root: '/fixtures' }).entries).toHaveLength(2);
      index.configure({ roots: [], exclusions: [], contentRoots: [], paused: true });
      await index.settled();
      expect(index.status().count).toBe(0);
      expect(index.query({ query: 'book' }).entries).toEqual([]);
    } finally {
      await index.close();
    }
  });
  it('crawls without following symlinks, supports literal search and scoped filters, and removes missing files', async () => {
    const files = path.join(root, 'files');
    await mkdir(files);
    await mkdir(path.join(files, '.hidden'));
    await mkdir(path.join(files, 'excluded'));
    await writeFile(path.join(files, 'Résumé 2000.epub'), epubFixture());
    await writeFile(path.join(files, 'notes.txt'), 'content marker');
    await writeFile(path.join(files, '.hidden', 'hidden.txt'), 'hidden');
    await writeFile(path.join(files, 'excluded', 'skip.txt'), 'skip');
    await symlink(root, path.join(files, 'loop'));
    const index = await FileIndex.open(path.join(root, 'index.sqlite'));
    try {
      index.configure({
        roots: [files],
        exclusions: ['excluded'],
        contentRoots: [],
        paused: false,
      });
      await index.settled();
      expect(
        index.query({ query: 'resume ext:epub', root: files }).entries.map((file) => file.name),
      ).toEqual(['Résumé 2000.epub']);
      expect(
        index.query({ query: 'ext:txt', root: files }).entries.map((file) => file.name),
      ).toEqual(['notes.txt']);
      expect(
        index
          .query({ query: 'kind:file size:>1kb', root: files })
          .entries.every((file) => !file.directory && file.size > 1024),
      ).toBe(true);
      expect(index.query({ query: '" OR *' }).entries).toEqual([]);
      expect(index.query({ query: '', root: root }).indexed).toBe(false);
      expect(index.status().count).toBeLessThan(10);
      await rename(path.join(files, 'notes.txt'), path.join(root, 'moved.txt'));
      await index.update(path.join(files, 'notes.txt'), true);
      expect(index.query({ query: 'notes' }).entries).toEqual([]);
      index.configure({
        roots: [files],
        exclusions: ['Résumé 2000.epub', 'excluded'],
        contentRoots: [],
        paused: true,
      });
      await index.settled();
      expect(index.query({ query: 'resume' }).entries).toEqual([]);
    } finally {
      await index.close();
    }
  });
  it('reads document content only after an explicit content-root grant', async () => {
    const file = path.join(root, 'book.txt');
    await writeFile(file, 'body marker');
    const extract = vi.fn(async () => 'body marker');
    const index = new FileIndex(':memory:', () => {}, extract);
    try {
      index.configure({ roots: [root], exclusions: [], contentRoots: [], paused: false });
      await index.settled();
      expect(extract).not.toHaveBeenCalled();
      expect(index.query({ query: 'marker', content: true }).entries).toEqual([]);
      index.configure({ roots: [root], exclusions: [], contentRoots: [root], paused: false });
      await index.settled();
      expect(extract).toHaveBeenCalledOnce();
      expect(index.query({ query: 'marker', content: true }).entries[0].path).toBe(file);
      await writeFile(file, 'updated');
      extract.mockResolvedValue('new marker');
      await index.update(file);
      expect(index.query({ query: 'new marker', content: true }).entries).toHaveLength(1);
      index.configure({ roots: [root], exclusions: [], contentRoots: [], paused: true });
      await index.settled();
      expect(index.query({ query: 'new marker', content: true }).entries).toEqual([]);
    } finally {
      await index.close();
    }
  });
  it('updates FTS rows and pages results without duplicating entries', async () => {
    const index = new FileIndex(':memory:');
    try {
      index.configure({ roots: [root], exclusions: [], contentRoots: [], paused: true });
      await index.settled();
      const base = await entry(root);
      const files = Array.from({ length: 17000 }, (_, i): FileEntry => ({
        ...base,
        path: path.join(root, `Record ${i}.pdf`),
        parent: root,
        name: `Record ${i}.pdf`,
        extension: 'pdf',
        kind: 'file',
        directory: false,
        hidden: false,
      }));
      index.ingest(files, root);
      for (let i = 0; i < 10; i++) index.put(files[0], root);
      expect(index.query({ query: 'Record', limit: 500 }).more).toBe(true);
      expect(index.query({ query: 'Record', offset: 500, limit: 500 }).entries).toHaveLength(500);
      const firstPage = index.query({ query: 'Record', limit: 500 }).entries;
      const secondPage = index.query({ query: 'Record', offset: 500, limit: 500 }).entries;
      expect(new Set([...firstPage, ...secondPage].map((file) => file.path)).size).toBe(1000);
      expect(firstPage.map((file) => file.name)).toEqual(
        [...files]
          .sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1))
          .slice(0, 500)
          .map((file) => file.name),
      );
      expect(index.status().count).toBe(17000);
      index.remove(files[0].path);
      expect(index.query({ query: 'Record 0.pdf' }).entries).toEqual([]);
    } finally {
      await index.close();
    }
  });
  it('cannot restore indexed body text after a permission revocation during extraction', async () => {
    const file = path.join(root, 'Delayed.txt');
    await writeFile(file, 'private text');
    let release!: (value: string) => void;
    let started!: () => void;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const delayed = new Promise<string>((resolve) => {
      release = resolve;
    });
    const index = new FileIndex(
      ':memory:',
      () => {},
      async () => {
        started();
        return delayed;
      },
    );
    try {
      index.configure({ roots: [root], exclusions: [], contentRoots: [root], paused: false });
      await began;
      index.configure({ roots: [root], exclusions: [], contentRoots: [], paused: false });
      release('private marker');
      await index.settled();
      expect(index.query({ query: 'delayed' }).entries[0]?.path).toBe(file);
      expect(index.query({ query: 'private marker', content: true }).entries).toEqual([]);
    } finally {
      release('');
      await index.close();
    }
  });
});
describe('local document extraction', () => {
  it('extracts EPUB publication fields and chapters without evaluating HTML', async () => {
    const file = path.join(root, 'Book.epub');
    await writeFile(file, epubFixture());
    const document = await extractDocument(file);
    expect(localBookFields(document)).toEqual({
      year: '2000',
      authors: 'J. E. Rehder',
      title: 'The mastery and uses of fire in antiquity',
      publisher: 'McGill-Queen’s University Press',
    });
    expect(document.chapters?.[0].title).toBe('Fire in antiquity');
    expect(document.text).not.toContain('forbidden');
  });
  it('rejects malformed or encrypted EPUBs and symbolic-link document extraction', async () => {
    const file = path.join(root, 'Bad.epub');
    await writeFile(file, 'not an archive');
    await expect(extractDocument(file)).rejects.toThrow();
    const actual = path.join(root, 'Actual.txt');
    await writeFile(actual, 'hello');
    const link = path.join(root, 'Link.txt');
    await symlink(actual, link);
    await expect(extractDocument(link)).rejects.toThrow();
  });
  it('reads image dimensions from bounded headers', () => {
    expect(imageDimensions(imageFixture)).toEqual({ width: 64, height: 64 });
    expect(imageDimensions(Buffer.alloc(24))).toBeUndefined();
  });
});
describe('protected credentials and structured providers', () => {
  it('does not touch secure storage when loading settings or listing credential IDs', async () => {
    const encrypt = vi.fn(async (value: string) => Buffer.from(value));
    const decrypt = vi.fn(async (value: Buffer) => value.toString());
    const credentials = new Credentials(root, encrypt, decrypt);
    await credentials.load();
    expect(credentials.ids()).toEqual([]);
    expect(await credentials.get('missing')).toBe('');
    expect(encrypt).not.toHaveBeenCalled();
    expect(decrypt).not.toHaveBeenCalled();
    await credentials.set('provider', 'fixture-key');
    expect(encrypt).toHaveBeenCalledOnce();
    expect(decrypt).not.toHaveBeenCalled();
    const reopened = new Credentials(root, encrypt, decrypt);
    await reopened.load();
    expect(reopened.ids()).toEqual(['provider']);
    expect(decrypt).not.toHaveBeenCalled();
    expect(await reopened.get('provider')).toBe('fixture-key');
    expect(decrypt).toHaveBeenCalledOnce();
  });
  it('serializes concurrent credential updates without exposing plaintext', async () => {
    const credentials = new Credentials(
      root,
      async (value) => Buffer.from('sealed:' + value),
      async (value) => value.toString().slice(7),
    );
    await Promise.all([credentials.set('first', 'one'), credentials.set('second', 'two')]);
    expect(credentials.ids().sort()).toEqual(['first', 'second']);
    expect(await credentials.get('first')).toBe('one');
    expect(await readFile(path.join(root, 'credentials-v1.json'), 'utf8')).not.toContain('"one"');
  });
  it.each(['openai', 'anthropic', 'local'] as const)(
    'uses the %s structured proposal API without retaining document data',
    async (kind) => {
      const credentials = new Credentials(
        root,
        async (value) => Buffer.from(value),
        async (value) => value.toString(),
      );
      await credentials.set('p', 'fixture-key');
      const json =
        kind === 'anthropic'
          ? { content: [{ type: 'tool_use', name: 'propose', input: { rows: [] } }] }
          : kind === 'openai'
            ? {
                status: 'completed',
                output: [{ content: [{ type: 'output_text', text: '{"rows":[]}' }] }],
              }
            : { choices: [{ message: { content: '{"rows":[]}' } }] };
      const request = vi.fn(async () => new Response(JSON.stringify(json)));
      const providers = new Providers(credentials, request as typeof fetch);
      const provider = {
        id: 'p',
        name: 'P',
        kind,
        endpoint:
          kind === 'openai'
            ? 'https://api.openai.com/v1'
            : kind === 'anthropic'
              ? 'https://api.anthropic.com/v1'
              : 'http://localhost:1234/v1',
        model: 'fixture',
        allowContent: true,
      };
      expect(
        await providers.generate(
          provider,
          'review names',
          [],
          { type: 'object' },
          new AbortController().signal,
        ),
      ).toEqual({ rows: [] });
      const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toContain(
        kind === 'openai' ? '/responses' : kind === 'anthropic' ? '/messages' : '/chat/completions',
      );
      const body = JSON.parse(init.body as string);
      if (kind === 'openai') expect(body.store).toBe(false);
      expect(init.signal).toBeTruthy();
    },
  );
});
