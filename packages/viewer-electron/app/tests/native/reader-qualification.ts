/** Pinned publications exercise EPUB content, navigation and retained reading positions. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultSettings } from '../../src/domain/services';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import type { SavedState } from '../../src/domain/contracts';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { epubReference } from '../../src/domain/previews/documents/epub';
import { temporaryRoot } from '../../tools/temporary';
import { readerSamples } from '../../tools/playground/reader-samples';
import { defaultPlaygroundDirectory } from '../../tools/playground/main';
import { ownedApp, until } from '../owned-app';
import { click, countOf, exists, pressButton } from './runtime/page';
import { pageCall } from './runtime/page-function';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const corpus = path.resolve(process.env.VIEWER_TEST_READER_CORPUS ?? defaultPlaygroundDirectory);
const samples = readerSamples.map((sample) => ({ ...sample, name: path.basename(sample.path) }));
const selectedSamples = samples.filter(
  (sample) => !process.argv[2] || sample.name === process.argv[2],
);
assert.ok(selectedSamples.length, 'The requested publication is in the pinned reader corpus.');
const root = await temporaryRoot('viewer-public-readers-');
const files = path.join(root, 'Files');
await mkdir(files);
const hash = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
for (const sample of samples) {
  assert.equal(path.basename(sample.name), sample.name);
  const source = path.join(corpus, sample.path),
    info = await lstat(source);
  assert.ok(info.isFile() && !info.isSymbolicLink());
  assert.equal(info.size, sample.size);
  assert.equal(await hash(source), sample.sha256);
  await copyFile(source, path.join(files, sample.name), 1);
}
const observations: unknown[] = [];
type App = Awaited<ReturnType<typeof ownedApp>>;
type Connection = Awaited<ReturnType<App['connect']>>;

interface ReaderWindow {
  __readerReturn: number;
}

const bookReady = () =>
  !!document.querySelector('.quick-preview .epub-chapter') &&
  !document.querySelector('.quick-preview .loading');

function selectRow(row: string): void {
  document.querySelector<HTMLElement>(row)!.click();
  document.querySelector<HTMLElement>('.folder-explorer')!.focus();
}

function pressChapter(index: number): void {
  document.querySelectorAll<HTMLElement>('.epub-body nav button')[index]!.click();
}

/** The index of the chapter button marked as the current page, or -1. */
const currentChapter = () =>
  [...document.querySelectorAll('.epub-body nav button')].findIndex(
    (button) => button.getAttribute('aria-current') === 'page',
  );

/** Sets an input's value through the native setter so React sees the change. */
function fillField(selector: string, value: string): void {
  const input = document.querySelector<HTMLInputElement>(selector)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Reads the whole publication through a fresh resource lease. */
async function documentData(file: string) {
  const resource = await window.viewer.resource(file);
  try {
    return await window.viewer.document(resource.id);
  } finally {
    await window.viewer.release(resource.id);
  }
}

/** The first note reference the published chapter source links to. */
function noteReference(html: string) {
  const source = new DOMParser().parseFromString(html, 'text/html');
  return [...source.querySelectorAll('a')]
    .find(
      (link) =>
        link.getAttribute('epub:type')?.split(/\s+/).includes('noteref') ||
        /^xnotes\.xhtml#/.test(link.getAttribute('href') || ''),
    )
    ?.getAttribute('href');
}

/** Scrolls into the chapter, records the position on `window`, then follows the note link. */
function followNote(href: string): boolean {
  const article = document.querySelector('.epub-chapter')!;
  const link = [...article.querySelectorAll('a')].find(
    (link) => link.getAttribute('href') === href,
  );
  if (!link) return false;
  article.scrollTop = Math.min(400, article.scrollHeight - article.clientHeight);
  (window as unknown as ReaderWindow).__readerReturn = article.scrollTop;
  link.click();
  return true;
}

const returnedToReading = () =>
  Math.abs(
    document.querySelector('.epub-chapter')!.scrollTop -
      (window as unknown as ReaderWindow).__readerReturn,
  ) < 2;

/** Scrolls the chapter and flushes the preview so the position is saved. */
function rememberScroll(): number {
  const article = document.querySelector('.epub-chapter')!;
  article.scrollTop = Math.min(500, article.scrollHeight - article.clientHeight);
  article.dispatchEvent(new Event('scroll'));
  window.dispatchEvent(new Event('viewer-preview-flush'));
  return article.scrollTop;
}

const chapterScrollTop = () => document.querySelector('.epub-chapter')!.scrollTop;

async function makeProfile(name: string) {
  const profile = path.join(root, name);
  await mkdir(profile);
  const settings = defaultSettings(files),
    ui = normalizePreferences();
  settings.hotkey.enabled = false;
  settings.providers = [];
  ui.sidebar.inNewPlanes = false;
  const state: SavedState = {
    version: CURRENT_STATE_VERSION,
    look: 'dark',
    activeWorkspace: name,
    favorites: [],
    recents: [],
    ui,
    workspaces: [
      {
        id: name,
        name,
        roots: ['folder'],
        activePane: 'folder',
        arrangement: {},
        panes: [
          {
            id: 'folder',
            type: 'folder',
            path: files,
            mode: 'list',
            sort: 'name',
            descending: false,
            showHidden: false,
            history: [files],
            historyIndex: 0,
            sidebar: { visible: false, width: 210 },
          },
        ],
      },
    ],
  };
  await writeFile(
    path.join(profile, 'config.jsonc'),
    JSON.stringify({ version: 1, settings, ui }),
    { flag: 'wx' },
  );
  await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), {
    flag: 'wx',
  });
  return profile;
}
function reader(connection: Connection) {
  const { evaluate, command } = connection;
  const key = async (key: string, code: string, virtual: number) => {
    for (const type of ['keyDown', 'keyUp'])
      await command('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: virtual });
  };
  const ready = () =>
    until(() => evaluate(pageCall(bookReady)), Boolean, 'Public EPUB ready', 20000);
  return {
    ready,
    text: () =>
      evaluate(
        pageCall(() => document.querySelector<HTMLElement>('.quick-preview')?.innerText ?? ''),
      ),
    open: async (name: string) => {
      const row = `[data-file-path="${path.join(files, name)}"]`;
      await until(() => evaluate(exists(row)), Boolean, 'Book listing');
      await evaluate(pageCall(selectRow, row));
      const start = performance.now();
      await key(' ', 'Space', 32);
      await ready();
      return performance.now() - start;
    },
    close: async () => {
      await key('Escape', 'Escape', 27);
      await until(
        () => evaluate(exists('.quick-preview')),
        (shown) => !shown,
        'Book closed',
      );
    },
    chapter: async (index: number) => {
      await evaluate(pageCall(pressChapter, index));
      await until(
        () => evaluate(pageCall(currentChapter)),
        (value) => value === index,
        'Selected publication chapter',
      );
    },
    selected: () => evaluate(pageCall(currentChapter)),
    fill: (selector: string, value: string) => evaluate(pageCall(fillField, selector, value)),
    click: (selector: string) => evaluate(click(selector)),
    capture: async (name: string, width = 1280, height = 900) => {
      await command('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await until(
        () =>
          evaluate(
            pageCall(
              () =>
                !!document.querySelector('.epub-chapter') &&
                !document.querySelector('[data-plurid-motion]'),
            ),
          ),
        Boolean,
        'Capture settled',
      );
      const image = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
      await writeFile(path.join(root, name + '.png'), Buffer.from(image.data, 'base64'), {
        flag: 'wx',
      });
    },
  };
}

let passed = false;
try {
  for (const sample of selectedSamples) {
    const profile = await makeProfile(sample.name.replace(/\.epub$/, ''));
    let app = await ownedApp(binary, profile),
      connection: Connection | undefined;
    try {
      connection = await app.connect();
      const { evaluate, command } = connection;
      const errors: unknown[] = [];
      await command('Runtime.enable');
      const unsubscribe = connection.onEvent((method, params) => {
        if (method === 'Runtime.exceptionThrown') errors.push(params);
      });
      let ui = reader(connection);
      const cold = await ui.open(sample.name);
      const data = await evaluate(pageCall(documentData, path.join(files, sample.name)));
      assert.ok(data.chapters?.length);
      assert.equal(await evaluate(countOf('.epub-body nav button')), data.chapters.length);
      const main = data.chapters.findIndex((chapter) => chapter.html.length > 10000);
      const imageChapter = data.chapters.findIndex((chapter) => /<img\b/i.test(chapter.html));
      if (imageChapter >= 0 && data.epub?.images.length) {
        await ui.chapter(imageChapter);
        await until(
          () =>
            evaluate(
              pageCall(() =>
                [...document.querySelectorAll<HTMLImageElement>('.epub-image img')].some(
                  (image) => image.complete && image.naturalWidth > 0,
                ),
              ),
            ),
          Boolean,
          'Publication illustration decoded',
        );
      }
      const notes = data.chapters.findIndex((chapter) =>
        /epub:type\s*=\s*["']noteref["']|href\s*=\s*["']xnotes\.xhtml#/i.test(chapter.html),
      );
      if (notes >= 0) {
        await ui.chapter(notes);
        const sourceLink = await evaluate(pageCall(noteReference, data.chapters[notes]!.html));
        assert.ok(sourceLink, 'Published note reference');
        const target = epubReference(data.chapters[notes]!.path!, sourceLink);
        assert.ok(target?.fragment, 'Published note target');
        const destination = data.chapters.findIndex((chapter) => chapter.path === target.path);
        assert.ok(destination >= 0, 'Note content is available');
        const selected = await evaluate(
          pageCall(followNote, '#' + encodeURIComponent(target.fragment)),
        );
        assert.ok(selected, 'Published internal note link');
        await until(
          () => evaluate(exists('[aria-label="Back to reading position"]')),
          Boolean,
          'Publication link history',
        );
        assert.equal(await ui.selected(), destination, 'Note opens its actual content document');
        await until(
          () =>
            evaluate(
              pageCall(() => document.activeElement?.getAttribute('data-epub-anchor') ?? ''),
            ),
          (anchor) => anchor === target.fragment,
          'Published footnote target receives focus',
        );
        await ui.click('[aria-label="Back to reading position"]');
        assert.equal(await ui.selected(), notes, 'Return restores the referring chapter');
        await until(
          () => evaluate(pageCall(returnedToReading)),
          Boolean,
          'Return from published footnote',
        );
      }
      await evaluate(pressButton('Find in book', '.quick-preview'));
      const query = sample.search;
      await ui.fill('[aria-label="Search book text"]', query);
      await until(ui.text, (text) => /\d+\+? matches/.test(text), 'Published book search', 20000);
      const matches = await evaluate(countOf('.epub-search li'));
      assert.ok(matches > 0 && matches <= 200);
      await ui.click('.epub-search li:last-child button');
      assert.ok(
        (
          await evaluate(
            pageCall(() =>
              [...document.querySelectorAll('[data-epub-match]')]
                .map((node) => node.textContent)
                .join(''),
            ),
          )
        )
          .toLowerCase()
          .includes(query.toLowerCase()),
      );
      await ui.capture(sample.name + '-search');
      await ui.fill('[aria-label="Search book text"]', 'this-phrase-is-absent-from-the-whole-book');
      await until(
        ui.text,
        (text) => text.includes('0 matches'),
        'Rapid search owns its last query',
      );
      await evaluate(pressButton('Find in book', '.quick-preview'));
      const rememberedChapter = main >= 0 ? main : Math.min(1, data.chapters.length - 1);
      await ui.chapter(rememberedChapter);
      const rememberedScroll = await evaluate(pageCall(rememberScroll));
      await ui.close();
      const warm = await ui.open(sample.name);
      assert.equal(await ui.selected(), rememberedChapter);
      await until(
        () => evaluate(pageCall(chapterScrollTop)),
        (top) => Math.abs(top - rememberedScroll) < 2,
        'Warm publication reading position',
      );
      await ui.capture(sample.name + '-reading', 760, 540);
      await ui.close();
      unsubscribe();
      assert.deepEqual(errors, []);
      await app.close(connection);
      connection = undefined;
      app = await ownedApp(binary, profile);
      connection = await app.connect();
      ui = reader(connection);
      await ui.open(sample.name);
      assert.equal(await ui.selected(), rememberedChapter);
      await until(
        () => connection!.evaluate(pageCall(chapterScrollTop)),
        (top) => Math.abs(top - rememberedScroll) < 2,
        'Cold publication reading position',
      );
      observations.push({
        name: sample.name,
        chapters: data.chapters.length,
        illustrations: data.epub?.images.length,
        imageChapter,
        notesChapter: notes,
        matches,
        rememberedChapter,
        rememberedScroll,
        cold,
        warm,
      });
      console.log(JSON.stringify(observations.at(-1)));
    } finally {
      await app.close(connection);
    }
  }
  passed = true;
} finally {
  for (const sample of samples) {
    assert.equal(await hash(path.join(corpus, sample.path)), sample.sha256);
    assert.equal(await hash(path.join(files, sample.name)), sample.sha256);
  }
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify({ passed, observations, samples }, null, 2),
    { flag: 'wx' },
  );
  console.log(JSON.stringify({ passed, evidence: path.basename(root) + '/result.json' }));
}
