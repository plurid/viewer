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

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await temporaryRoot('viewer-native-preview-restoration-');
const files = path.join(root, 'Files');
const profile = path.join(root, 'Profile');
await Promise.all([mkdir(files), mkdir(profile)]);
const samples = await localSamples();
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
  'Book.pdf': workbenchPDF(['Generated page one', 'Generated page two', 'Generated page three']),
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
  'Motion.mp4': sample('mp4'),
  'Tone.wav': sample('wav'),
  'Model.obj': sample('obj'),
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
let passed = false;

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
    const scope = (id: string) =>
      `document.querySelector('.plane-controls[data-viewer-plane="${id}"]')?.closest('[data-plurid-plane]')`;
    const open = async (name: string, ready: string) => {
      const file = path.join(files, name);
      await until(
        () => evaluate<boolean>(`!!document.querySelector('[data-file-path="${file}"]')`),
        Boolean,
        'Fixture row ' + name,
      );
      await evaluate(
        `(() => { const row = document.querySelector('[data-file-path="${file}"]'); row.click(); row.focus(); })()`,
      );
      for (const type of ['keyDown', 'keyUp'])
        await command('Input.dispatchKeyEvent', {
          type,
          key: ' ',
          code: 'Space',
          windowsVirtualKeyCode: 32,
        });
      await until(
        () => evaluate<boolean>('!!document.querySelector(".quick-preview-dialog")'),
        Boolean,
        'Quick Preview',
      );
      await until(
        () =>
          evaluate<boolean>(
            '!![...document.querySelectorAll(".quick-preview-dialog button")].find(button => button.textContent.trim() === "Open linked plane" && !button.disabled)',
          ),
        Boolean,
        'Linked plane action',
      );
      await evaluate(
        '[...document.querySelectorAll(".quick-preview-dialog button")].find(button => button.textContent.trim() === "Open linked plane").click()',
      );
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
      await until(
        () => evaluate<boolean>(`!!${scope(pane.id)}?.querySelector(${JSON.stringify(ready)})`),
        Boolean,
        'Ready ' + name,
        20000,
      );
      return pane.id;
    };
    const close = async (id: string) => {
      await evaluate(
        `document.querySelector('.plane-controls[data-viewer-plane="${id}"] [aria-label="Close plane"]').click()`,
      );
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
      if (target.name === 'Book.epub') {
        if (launch === 0)
          await evaluate(`${scope(id)}.querySelector('[aria-label="Next chapter"]').click()`);
        await until(
          () =>
            evaluate<boolean>(
              `${scope(id)}.querySelectorAll('.epub-body nav button')[1]?.getAttribute('aria-current') === 'page'`,
            ),
          Boolean,
          'Second EPUB chapter',
        );
      }
      if (launch === 0) {
        await evaluate(
          `(() => { const element = ${scope(id)}.querySelector(${JSON.stringify(target.selector)}); element.scrollTop = ${target.top}; element.dispatchEvent(new Event('scroll')); })()`,
        );
      } else {
        await until(
          () =>
            evaluate<number>(
              `${scope(id)}.querySelector(${JSON.stringify(target.selector)}).scrollTop`,
            ),
          (top) => Math.abs(top - target.top) < 2,
          'Restored offset ' + target.name,
        );
      }
      observations.push({
        launch,
        name: target.name,
        id,
        offset: await evaluate<number>(
          `${scope(id)}.querySelector(${JSON.stringify(target.selector)}).scrollTop`,
        ),
      });
      oldIDs.set(target.name, id);
      await close(id);
    }
    const pdf = await open('Book.pdf', '.pdf-scroll canvas');
    if (launch === 0) {
      await evaluate(
        `(() => { const input = ${scope(pdf)}.querySelector('.page-number'); input.focus(); input.select(); })()`,
      );
      await command('Input.insertText', { text: '3' });
      await command('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      });
    }
    await until(
      () => evaluate<string>(`${scope(pdf)}.querySelector('.page-number').value`),
      (value) => value === '3',
      'PDF page three',
    );
    if (launch === 0) {
      await evaluate(`${scope(pdf)}.querySelector('[aria-label="PDF zoom"]').click()`);
      await until(
        () => evaluate<string>('document.activeElement?.getAttribute("aria-label")'),
        (label) => label === 'Search PDF zoom',
        'PDF zoom choices',
      );
      await command('Input.insertText', { text: '200%' });
      await until(
        () =>
          evaluate<string>(
            'document.querySelector(".choice-menu .command-result[aria-selected=true]")?.textContent',
          ),
        (value) => value?.includes('200%'),
        '200 percent zoom',
      );
      await evaluate(
        'document.querySelector(".choice-menu .command-result[aria-selected=true]").click()',
      );
    }
    await until(
      () => evaluate<string>(`${scope(pdf)}.querySelector('[aria-label="PDF zoom"]').textContent`),
      (value) => value.includes('200%'),
      'Remembered PDF zoom',
    );
    await until(
      () =>
        evaluate<boolean>(
          `${scope(pdf)}.querySelector('.pdf-scroll').scrollHeight - ${scope(pdf)}.querySelector('.pdf-scroll').clientHeight > 450`,
        ),
      Boolean,
      'Zoomed PDF ready',
    );
    await evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    if (launch === 0)
      await evaluate(
        `(() => { const element = ${scope(pdf)}.querySelector('.pdf-scroll'); element.scrollTop = 400; element.dispatchEvent(new Event('scroll')); })()`,
      );
    else
      await until(
        () => evaluate<number>(`${scope(pdf)}.querySelector('.pdf-scroll').scrollTop`),
        (value) => Math.abs(value - 400) < 2,
        'PDF page and scroll recall',
      );
    oldIDs.set('Book.pdf', pdf);
    await close(pdf);
    const media = await open('Motion.mp4', 'video');
    await until(
      () => evaluate<number>(`${scope(media)}.querySelector('video').readyState`),
      (value) => value >= 1,
      'Video metadata',
    );
    if (launch === 0)
      await evaluate(
        `(() => { const media = ${scope(media)}.querySelector('video'); media.currentTime = 0.125; })()`,
      );
    else
      await until(
        () => evaluate<number>(`${scope(media)}.querySelector('video').currentTime`),
        (value) => Math.abs(value - 0.125) < 0.02,
        'Exact fractional media position',
      );
    oldIDs.set('Motion.mp4', media);
    await close(media);
    const audio = await open('Tone.wav', 'audio');
    await until(
      () => evaluate<number>(`${scope(audio)}.querySelector('audio').readyState`),
      (value) => value >= 1,
      'Audio metadata',
    );
    if (launch === 0)
      await evaluate(
        `(() => { const media = ${scope(audio)}.querySelector('audio'); media.currentTime = 0.125; })()`,
      );
    else
      await until(
        () => evaluate<number>(`${scope(audio)}.querySelector('audio').currentTime`),
        (value) => Math.abs(value - 0.125) < 0.02,
        'Exact audio position',
      );
    oldIDs.set('Tone.wav', audio);
    await close(audio);
    const model = await open('Model.obj', '.model-info');
    if (launch === 0) {
      const bounds = await evaluate<{ x: number; y: number }>(
        `(() => { const bounds = ${scope(model)}.querySelector('.model-stage canvas').getBoundingClientRect(); return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }; })()`,
      );
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
      (entry) => entry.path === path.join(files, 'Model.obj'),
    )?.values['model.camera'];
    assert.ok(camera, 'Orbit camera retained in file recall');
    if (launch === 0) observations.push({ name: 'Model.obj', camera });
    else
      assert.deepEqual(
        camera,
        (
          observations.find((item) => typeof item === 'object' && item && 'camera' in item) as {
            camera: unknown;
          }
        ).camera,
      );
    oldIDs.set('Model.obj', model);
    if (launch === 1) passed = true;
  } finally {
    await writeFile(
      path.join(root, `result-${launch}.json`),
      JSON.stringify({ passed, binary, root, observations }, null, 2),
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
