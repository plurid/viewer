/** Real close/new-plane/cold-restart recall. Generated content and all evidence are retained. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { defaultSettings } from '../../src/domain/services';
import { localSamples } from '../../tools/playground/catalog';
import { temporaryRoot } from '../../tools/temporary';
import { workbenchPDF } from '../pdf-fixtures';
import { officeFixture } from '../office-fixtures';
import { ownedApp, until } from '../owned-app';
import { animationFrames, buttonState, click, exists, pressButton, textOf } from './runtime/page';
import { pageCall } from './runtime/page-function';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await temporaryRoot('viewer-native-preview-restoration-');
const files = path.join(root, 'Files');
const profile = path.join(root, 'Profile');
await Promise.all([mkdir(files), mkdir(profile)]);
const samples = await localSamples();
const realPDF = process.env.VIEWER_TEST_REAL_PDF;
const realVideo = process.env.VIEWER_TEST_REAL_VIDEO;
const realModel = process.env.VIEWER_TEST_REAL_MODEL;
const modelName = realModel ? 'Model.glb' : 'Model.obj';
const videoPosition = realVideo ? 245.125 : 0.125;
const sample = (format: string) => {
  const value = samples.find((item) => item.formats.includes(format));
  assert.ok(value);
  return typeof value.bytes === 'string' ? strToU8(value.bytes) : value.bytes;
};
const epub = unzipSync(sample('epub'));
for (const name of ['Book/first.xhtml', 'Book/second.xhtml']) {
  assert.ok(epub[name]);
  epub[name] = strToU8(
    strFromU8(epub[name]!).replace(
      '</body>',
      Array.from(
        { length: 100 },
        (_, index) => `<p>Generated paragraph ${index}. A retained reading position.</p>`,
      ).join('') + '</body>',
    ),
  );
}
const fixtures: Record<string, string | Uint8Array> = {
  'Book.pdf': realPDF
    ? await readFile(realPDF)
    : workbenchPDF(['Generated page one', 'Generated page two', 'Generated page three']),
  'Book.epub': zipSync(epub),
  'Document.docx': officeFixture('word', {
    'word/custom/document.xml':
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      Array.from(
        { length: 120 },
        (_, index) =>
          `<w:p><w:r><w:t>Generated paragraph ${index}. Remember this document position.</w:t></w:r></w:p>`,
      ).join('') +
      '</w:body></w:document>',
  }),
  'Source.txt': Array.from({ length: 600 }, (_, index) => `Generated source line ${index}`).join(
    '\n',
  ),
  'Notes.md': Array.from(
    { length: 100 },
    (_, index) => `## Section ${index}\n\nGenerated Markdown reading position.\n`,
  ).join('\n'),
  'Records.csv':
    'id,name\n' +
    Array.from({ length: 5000 }, (_, index) => `${index},Generated record ${index}`).join('\n'),
  'Motion.mp4': realVideo ? await readFile(realVideo) : sample('mp4'),
  'Tone.wav': sample('wav'),
  [modelName]: realModel ? await readFile(realModel) : sample('obj'),
};
const hashes: Record<string, string> = {};
for (const [name, bytes] of Object.entries(fixtures)) {
  await writeFile(path.join(files, name), bytes, { flag: 'wx' });
  hashes[name] = createHash('sha256').update(bytes).digest('hex');
}
const settings = defaultSettings(files);
settings.hotkey.enabled = false;
settings.providers = [];
const ui = normalizePreferences();
ui.space.opening = 'dock';
ui.sidebar.inNewPlanes = false;
const initial: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'recall',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'recall',
      name: 'Preview restoration acceptance',
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
const stateFile = path.join(profile, 'viewer-state-v1.json');
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
});
await writeFile(stateFile, JSON.stringify(initial), { flag: 'wx' });
const saved = async () => JSON.parse(await readFile(stateFile, 'utf8')) as SavedState;
const observations: unknown[] = [];
const oldIDs = new Map<string, string>();
let pdfTextElements: number | undefined;
let passed = false;

/** The header of pane `id`'s plane; the page functions below act inside its Plurid plane. */
const planeHeader = (id: string) => `.plane-controls[data-viewer-plane="${id}"]`;
const near = (value: number | undefined, expected: number, tolerance: number) =>
  value !== undefined && Math.abs(value - expected) < tolerance;

function clickAndFocus(selector: string): void {
  const element = document.querySelector<HTMLElement>(selector)!;
  element.click();
  element.focus();
}

const planeHas = (header: string, selector: string) =>
  !!document.querySelector(header)?.closest('[data-plurid-plane]')?.querySelector(selector);

/** Clicks inside the plane; as before, nothing happens without the header, and a missing element
 * throws. */
function clickInPlane(header: string, selector: string): void {
  document
    .querySelector(header)
    ?.closest('[data-plurid-plane]')!
    .querySelector<HTMLElement>(selector)!
    .click();
}

function pressToolbarButton(header: string, label: string): void {
  const plane = document.querySelector(header)!.closest('[data-plurid-plane]')!;
  [...plane.querySelectorAll<HTMLElement>('.preview-toolbar button')]
    .find((button) => button.textContent.trim() === label)!
    .click();
}

function scrollInPlane(header: string, selector: string, top: number): void {
  const plane = document.querySelector(header)!.closest('[data-plurid-plane]')!;
  const element = plane.querySelector(selector)!;
  element.scrollTop = top;
  element.dispatchEvent(new Event('scroll'));
}

function selectInPlane(header: string, selector: string): void {
  const plane = document.querySelector(header)!.closest('[data-plurid-plane]')!;
  const input = plane.querySelector<HTMLInputElement>(selector)!;
  input.focus();
  input.select();
}

function seekInPlane(header: string, tag: 'video' | 'audio', seconds: number): void {
  const plane = document.querySelector(header)!.closest('[data-plurid-plane]')!;
  const media = plane.querySelector(tag)!;
  media.currentTime = seconds;
}

// Reads find the plane from its header and answer undefined or false until it shows.
function chapterIsCurrent(header: string, index: number): boolean {
  const plane = document.querySelector(header)?.closest('[data-plurid-plane]');
  return (
    plane?.querySelectorAll('.epub-body nav button')[index]?.getAttribute('aria-current') === 'page'
  );
}

function scrollTopIn(header: string, selector: string) {
  const plane = document.querySelector(header)?.closest('[data-plurid-plane]');
  return plane?.querySelector(selector)?.scrollTop;
}

function valueIn(header: string, selector: string) {
  const plane = document.querySelector(header)?.closest('[data-plurid-plane]');
  return plane?.querySelector<HTMLInputElement>(selector)?.value;
}

function textIn(header: string, selector: string) {
  const plane = document.querySelector(header)?.closest('[data-plurid-plane]');
  return plane?.querySelector(selector)?.textContent;
}

/** Whether the PDF can scroll more than 450px, so it has laid out at the new zoom. */
function zoomedPDFReady(header: string): boolean {
  const plane = document.querySelector(header)?.closest('[data-plurid-plane]');
  const scroll = plane?.querySelector('.pdf-scroll');
  return !!scroll && scroll.scrollHeight - scroll.clientHeight > 450;
}

/** Samples the PDF scroll offset and text layer size twelve times, 25 ms apart. */
async function pdfScrollSamples(header: string) {
  const plane = document.querySelector(header)!.closest('[data-plurid-plane]')!;
  const element = plane.querySelector('.pdf-scroll')!;
  const started = performance.now();
  const samples: { milliseconds: number; top: number; text: number }[] = [];
  for (let index = 0; index < 12; index++) {
    samples.push({
      milliseconds: performance.now() - started,
      top: element.scrollTop,
      text: element.querySelector('.textLayer')?.childElementCount || 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return samples;
}

function mediaIn(header: string, tag: 'video' | 'audio') {
  const plane = document.querySelector(header)?.closest('[data-plurid-plane]');
  const media = plane?.querySelector(tag);
  return media && { readyState: media.readyState, time: media.currentTime, seeking: media.seeking };
}

function videoDetails(header: string) {
  const plane = document.querySelector(header)!.closest('[data-plurid-plane]')!;
  const video = plane.querySelector('video')!;
  return {
    duration: video.duration,
    width: video.videoWidth,
    height: video.videoHeight,
    time: video.currentTime,
  };
}

function centreInPlane(header: string, selector: string) {
  const plane = document.querySelector(header)!.closest('[data-plurid-plane]')!;
  const bounds = plane.querySelector(selector)!.getBoundingClientRect();
  return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
}

for (let launch = 0; launch < 2; launch += 1) {
  const app = await ownedApp(binary, profile);
  let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
  try {
    connection = await app.connect();
    const { evaluate, command } = connection;
    await command('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 940,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const open = async (name: string, ready: string) => {
      const file = path.join(files, name);
      const row = `[data-file-path="${file}"]`;
      await until(() => evaluate(exists(row)), Boolean, 'Fixture row ' + name);
      await evaluate(pageCall(clickAndFocus, row));
      for (const type of ['keyDown', 'keyUp'])
        await command('Input.dispatchKeyEvent', {
          type,
          key: ' ',
          code: 'Space',
          windowsVirtualKeyCode: 32,
        });
      await until(() => evaluate(exists('.quick-preview-dialog')), Boolean, 'Quick Preview');
      await until(
        () => evaluate(buttonState('Open linked plane', '.quick-preview-dialog')),
        (state) => state === 'enabled',
        'Linked plane action',
      );
      await evaluate(pressButton('Open linked plane', '.quick-preview-dialog'));
      const state = await until(
        saved,
        (state) =>
          state.workspaces[0]!.panes.some((pane) => pane.type === 'preview' && pane.path === file),
        'New preview record',
      );
      const pane = state.workspaces[0]!.panes.find(
        (pane) => pane.type === 'preview' && pane.path === file,
      )!;
      assert.notEqual(pane.id, oldIDs.get(name), 'Reopening creates a fresh plane ID');
      const header = planeHeader(pane.id);
      if (name === 'Document.docx') {
        await until(
          () => evaluate(pageCall(planeHas, header, '.preview-toolbar')),
          Boolean,
          'Office view choices',
        );
        await evaluate(pageCall(pressToolbarButton, header, 'Reading'));
      }
      await until(
        () => evaluate(pageCall(planeHas, header, ready)),
        Boolean,
        'Ready ' + name,
        20000,
      );
      return pane.id;
    };
    const close = async (id: string) => {
      await evaluate(click(planeHeader(id) + ' [aria-label="Close plane"]'));
      await until(
        saved,
        (state) => !state.workspaces[0]!.panes.some((pane) => pane.id === id),
        'Closed preview',
      );
    };
    const cases = [
      { name: 'Source.txt', selector: '.code-scroll', top: 640 },
      { name: 'Notes.md', selector: '.markdown', top: 500 },
      { name: 'Records.csv', selector: '.data-scroll', top: 960 },
      { name: 'Document.docx', selector: '.office-document-scroll', top: 600 },
      { name: 'Book.epub', selector: '.epub-chapter', top: 500 },
    ];
    for (const target of cases) {
      const id = await open(target.name, target.selector);
      const header = planeHeader(id);
      if (target.name === 'Book.epub') {
        if (launch === 0)
          await evaluate(pageCall(clickInPlane, header, '[aria-label="Next chapter"]'));
        await until(
          () => evaluate(pageCall(chapterIsCurrent, header, 1)),
          Boolean,
          'Second EPUB chapter',
        );
      }
      if (launch === 0) {
        await evaluate(pageCall(scrollInPlane, header, target.selector, target.top));
      } else {
        await until(
          () => evaluate(pageCall(scrollTopIn, header, target.selector)),
          (top) => near(top, target.top, 2),
          'Restored offset ' + target.name,
        );
      }
      observations.push({
        launch,
        name: target.name,
        id,
        offset: await evaluate(pageCall(scrollTopIn, header, target.selector)),
      });
      oldIDs.set(target.name, id);
      await close(id);
    }
    const pdf = await open('Book.pdf', '.pdf-scroll canvas');
    const pdfHeader = planeHeader(pdf);
    if (launch === 0) {
      await evaluate(pageCall(selectInPlane, pdfHeader, '.page-number'));
      await command('Input.insertText', { text: '3' });
      await command('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      });
    }
    await until(
      () => evaluate(pageCall(valueIn, pdfHeader, '.page-number')),
      (value) => value === '3',
      'PDF page three',
    );
    if (launch === 0) {
      await evaluate(pageCall(clickInPlane, pdfHeader, '[aria-label="PDF zoom"]'));
      await until(
        () => evaluate(pageCall(() => document.activeElement?.getAttribute('aria-label'))),
        (label) => label === 'Search PDF zoom',
        'PDF zoom choices',
      );
      await command('Input.insertText', { text: '200%' });
      await until(
        () => evaluate(textOf('.choice-menu .command-result[aria-selected=true]')),
        (value) => value.includes('200%'),
        '200 percent zoom',
      );
      await evaluate(click('.choice-menu .command-result[aria-selected=true]'));
    }
    await until(
      () => evaluate(pageCall(textIn, pdfHeader, '[aria-label="PDF zoom"]')),
      (value) => value?.includes('200%'),
      'Remembered PDF zoom',
    );
    await until(() => evaluate(pageCall(zoomedPDFReady, pdfHeader)), Boolean, 'Zoomed PDF ready');
    await evaluate(animationFrames(2));
    if (launch === 0) await evaluate(pageCall(scrollInPlane, pdfHeader, '.pdf-scroll', 400));
    else
      await until(
        () => evaluate(pageCall(scrollTopIn, pdfHeader, '.pdf-scroll')),
        (value) => near(value, 400, 2),
        'PDF page and scroll recall',
      );
    const pdfOffsets = await evaluate(pageCall(pdfScrollSamples, pdfHeader));
    observations.push({ launch, name: 'Book.pdf', offsets: pdfOffsets });
    console.log(JSON.stringify({ launch, name: 'Book.pdf', offsets: pdfOffsets }));
    assert.ok(
      pdfOffsets.every((sample) => Math.abs(sample.top - 400) < 2),
      "Late PDF text rendering preserves the reader's scroll",
    );
    const textElements = pdfOffsets.at(-1)!.text;
    assert.ok(textElements > 0, 'The PDF text layer finished rendering');
    if (launch === 0) pdfTextElements = textElements;
    else assert.equal(textElements, pdfTextElements, 'Reopening must not duplicate the PDF text');
    oldIDs.set('Book.pdf', pdf);
    await close(pdf);
    const media = await open('Motion.mp4', 'video');
    const mediaHeader = planeHeader(media);
    await until(
      () => evaluate(pageCall(mediaIn, mediaHeader, 'video')),
      (state) => !!state && state.readyState >= 1,
      'Video metadata',
    );
    if (launch === 0) await evaluate(pageCall(seekInPlane, mediaHeader, 'video', videoPosition));
    else
      await until(
        () => evaluate(pageCall(mediaIn, mediaHeader, 'video')),
        (state) => near(state?.time, videoPosition, 0.02),
        'Exact fractional media position',
      );
    oldIDs.set('Motion.mp4', media);
    if (realVideo) {
      await until(
        () => evaluate(pageCall(mediaIn, mediaHeader, 'video')),
        (state) => !!state && state.readyState >= 2 && !state.seeking,
        'Long movie decoded seek',
      );
      const video = await evaluate(pageCall(videoDetails, mediaHeader));
      assert.ok(video.duration > 590);
      assert.ok(video.width >= 640);
      observations.push({ launch, name: 'Motion.mp4', ...video });
    }
    await close(media);
    const audio = await open('Tone.wav', 'audio');
    const audioHeader = planeHeader(audio);
    await until(
      () => evaluate(pageCall(mediaIn, audioHeader, 'audio')),
      (state) => !!state && state.readyState >= 1,
      'Audio metadata',
    );
    if (launch === 0) await evaluate(pageCall(seekInPlane, audioHeader, 'audio', 0.125));
    else
      await until(
        () => evaluate(pageCall(mediaIn, audioHeader, 'audio')),
        (state) => near(state?.time, 0.125, 0.02),
        'Exact audio position',
      );
    oldIDs.set('Tone.wav', audio);
    await close(audio);
    const model = await open(modelName, '.model-info');
    const modelHeader = planeHeader(model);
    if (realModel)
      assert.equal(
        (await evaluate(pageCall(textIn, modelHeader, '.inline-warning'))) || '',
        '',
        'Embedded textures load without missing-asset warnings',
      );
    if (realModel && launch === 0) {
      await evaluate(animationFrames(2));
      const screenshot = await command<{ data: string }>('Page.captureScreenshot', {
        format: 'png',
      });
      await writeFile(
        path.join(root, 'textured-model.png'),
        Buffer.from(screenshot.data, 'base64'),
        { flag: 'wx' },
      );
    }
    if (launch === 0) {
      const bounds = await evaluate(pageCall(centreInPlane, modelHeader, '.model-stage canvas'));
      await command('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: bounds.x,
        y: bounds.y,
        button: 'left',
        clickCount: 1,
      });
      for (let step = 1; step <= 5; step += 1)
        await command('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: bounds.x + step * 12,
          y: bounds.y + step * 5,
          button: 'left',
          buttons: 1,
        });
      await command('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: bounds.x + 60,
        y: bounds.y + 25,
        button: 'left',
        clickCount: 1,
      });
    }
    await close(model);
    const camera = (await saved()).previewHistory?.recall?.find(
      (entry) => entry.path === path.join(files, modelName),
    )?.values['model.camera'];
    assert.ok(camera, 'Orbit camera retained in file recall');
    if (launch === 0) observations.push({ name: modelName, camera });
    else
      assert.deepEqual(
        camera,
        (
          observations.find((item) => typeof item === 'object' && item && 'camera' in item) as {
            camera: unknown;
          }
        ).camera,
      );
    oldIDs.set(modelName, model);
    if (launch === 1) passed = true;
  } finally {
    await writeFile(
      path.join(root, `result-${launch}.json`),
      JSON.stringify(
        { passed, binary: path.basename(binary), fixture: path.basename(root), observations },
        null,
        2,
      ),
      { flag: 'wx' },
    );
    await app.close(connection);
  }
}
for (const [name, expected] of Object.entries(hashes))
  assert.equal(
    createHash('sha256')
      .update(await readFile(path.join(files, name)))
      .digest('hex'),
    expected,
    'Original retained: ' + name,
  );
console.log('Preview restoration passed; evidence retained:', root);
