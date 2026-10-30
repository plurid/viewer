/** Opens one playground sample per added format in Quick Preview and checks what it shows. This
 * qualifies the samples, not every file with the extension. */
import assert from 'node:assert/strict';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { defaultPlaygroundDirectory } from '../../tools/playground/main';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { countOf, exists } from './runtime/page';
import { pageCall } from './runtime/page-function';
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const playground = path.resolve(process.env.VIEWER_TEST_REAL_CORPUS ?? defaultPlaygroundDirectory);

/** A sample, the element its preview must show inside Quick Preview, and text it must hold. */
interface Sample {
  path: string;
  selector: string;
  texts?: string[];
}
const saved = '[data-preview-module="embedded"] .embedded-viewer img';
const model = '.model-stage canvas';
const raw = '[data-preview-module="rendered-image"] .image-stage img';
const office = '[data-office-layout] .pdf-sheet canvas';
const hex = '[role="grid"][aria-label="File bytes"]';
const certificate = '[data-preview-module="certificate"]';
const samples: Sample[] = [
  { path: 'saved-previews/Field notes.pages', selector: saved, texts: ['Pages document'] },
  { path: 'saved-previews/Field notes.numbers', selector: saved, texts: ['Numbers spreadsheet'] },
  { path: 'saved-previews/Field notes.key', selector: saved, texts: ['Keynote presentation'] },
  { path: 'saved-previews/Field notes package.pages', selector: saved, texts: ['Pages document'] },
  { path: 'saved-previews/Field notes.kra', selector: saved, texts: ['640 × 480 canvas'] },
  { path: 'saved-previews/Field notes.ora', selector: saved, texts: ['640 × 480 canvas'] },
  { path: 'saved-previews/Field notes.sketch', selector: saved, texts: ['2 pages'] },
  { path: 'saved-previews/Field notes.xps', selector: saved, texts: ['3 pages'] },
  {
    path: 'saved-previews/Field notes.oxps',
    selector: '[data-preview-module="embedded"]',
    texts: ['No preview image in this document', '2 pages'],
  },
  ...['dae', '3ds', 'usdz', 'wrl', 'x3d', 'off'].map((extension) => ({
    path: 'models/Reference block.' + extension,
    selector: model,
    texts: ['12 triangles'],
  })),
  ...[
    'Nikon-COOLPIX-P1000.NRW',
    'Samsung-NX500.SRW',
    'Pentax-K10D.PEF',
    'Leica-D-LUX-5.RWL',
    'Hasselblad-H3D.3FR',
    'Phase-One-P65-Plus.IIQ',
    'Epson-R-D1.ERF',
    'Minolta-DiMAGE-5.MRW',
    'Kodak-P712.KDC',
    'Kodak-DCS760C.DCR',
    'Sony-DSC-F828.SRF',
    'Sony-DSC-R1.SR2',
    'Leaf-Aptus-22.MOS',
  ].map((name) => ({ path: 'images/camera-raw/' + name, selector: raw })),
  { path: 'documents/Field notes template.ott', selector: office },
  { path: 'documents/Field notes template.ots', selector: office, texts: ['Materials', 'Notes'] },
  { path: 'documents/Field notes template.otp', selector: office },
  { path: 'documents/SampleBrochure.pub', selector: office },
  { path: 'documents/nested_wmf.emf', selector: office },
  { path: 'documents/santa.wmf', selector: office },
  ...[
    'Soft tone.oga',
    'AMR narrowband.amr',
    "Monkey's Audio tone.ape",
    'Soft tone.au',
    'Soft tone.snd',
    'Soft tone.mp2',
    'Soft tone.mpa',
  ].map((name) => ({ path: 'audio/' + name, selector: 'audio' })),
  ...['m2v', 'f4v', 'ts', 'mts'].map((extension) => ({
    path: 'video/Motion study.' + extension,
    selector: 'video',
  })),
  ...['ts', 'mts'].map((extension) => ({
    path: 'code-and-data/Example.' + extension,
    selector: '[data-preview-module="text"]',
    texts: ['export interface Material'],
  })),
  {
    path: 'messages/Field trip.eml',
    selector: 'iframe.mail-frame',
    texts: ['Saturday at the lighthouse', 'Remote images are blocked.', 'Packing list'],
  },
  { path: 'messages/Field trip.emlx', selector: 'iframe.mail-frame', texts: ['Packing list'] },
  { path: 'messages/Field team.mbox', selector: 'ol.mailbox-messages', texts: ['Gear list'] },
  { path: 'documents/Lighthouse notes.fb2', selector: '.epub-chapter', texts: ['Lighthouse'] },
  {
    path: 'documents/Lighthouse trip.webarchive',
    selector: 'iframe.html-preview-frame',
    texts: ['the lighthouse trip'],
  },
  {
    path: 'certificates/Sample chain.pem',
    selector: certificate,
    texts: ['Viewer Sample Root CA', '3 certificates'],
  },
  { path: 'certificates/Expired sample.pem', selector: certificate, texts: ['Expired'] },
  {
    path: 'certificates/Sample root CA.crt',
    selector: certificate,
    texts: ['Certificate authority', 'Self-signed'],
  },
  { path: 'certificates/Sample server.cer', selector: certificate, texts: ['EC P-256'] },
  { path: 'certificates/Sample intermediate CA.der', selector: certificate, texts: ['Ed25519'] },
  { path: 'certificates/Sample server key.pub', selector: certificate, texts: ['EC P-256'] },
  {
    path: 'certificates/Sample signing key.asc',
    selector: certificate,
    texts: ['Viewer Sample Signing Key'],
  },
  {
    path: 'certificates/Sample development.mobileprovision',
    selector: '[data-preview-module="provision"]',
    texts: ['EXAMPLE123.com.example.viewer-sample'],
  },
  {
    path: 'certificates/Sample Developer ID.provisionprofile',
    selector: '[data-preview-module="provision"]',
    texts: ['macOS'],
  },
  {
    path: 'shortcuts/Viewer guide.url',
    selector: '[data-preview-module="shortcut"]',
    texts: ['example.org', 'Open in Browser'],
  },
  {
    path: 'shortcuts/Example site.webloc',
    selector: '[data-preview-module="shortcut"]',
    texts: ['www.example.com', 'Open in Browser'],
  },
  {
    path: 'shortcuts/Write to samples.webloc',
    selector: '[data-preview-module="shortcut"]',
    texts: ['Open in Mail App'],
  },
  {
    path: 'torrents/Viewer sample.torrent',
    selector: '[data-preview-module="torrent"]',
    texts: ['b2994a2be3f3fc171a620b860a77c2f2e29d5569', '241 files'],
  },
  { path: 'binaries/Noise.bin', selector: hex },
  { path: 'binaries/Universal object.o', selector: hex, texts: ['Mach-O universal binary'] },
  { path: 'binaries/Add.wasm', selector: hex, texts: ['WebAssembly module'] },
  { path: 'binaries/Sample.class', selector: hex, texts: ['Java class file'] },
];

const root = await temporaryRoot('viewer-native-format-samples-'),
  files = path.join(root, 'Files'),
  profile = path.join(root, 'Profile');
await Promise.all([mkdir(files), mkdir(profile)]);
for (const sample of samples)
  await cp(
    path.join(playground, 'previews', sample.path),
    path.join(files, path.basename(sample.path)),
    { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true },
  );
const settings = defaultSettings(files),
  ui = normalizePreferences();
settings.hotkey.enabled = false;
settings.providers = [];
ui.sidebar.inNewPlanes = false;
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'formats',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'formats',
      name: 'Format samples',
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
        },
      ],
    },
  ],
};
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
});
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), { flag: 'wx' });

/** Scrolls the virtualized list until `file`'s row renders, then selects it. */
async function selectRow(file: string): Promise<boolean> {
  const scroll = document.querySelector<HTMLElement>('.folder-explorer .file-scroll')!;
  for (let top = 0; top <= scroll.scrollHeight; top += scroll.clientHeight / 2) {
    scroll.scrollTop = top;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const row = [...document.querySelectorAll<HTMLElement>('[data-file-path]')].find(
      (element) => element.dataset.filePath === file,
    );
    if (row) {
      row.click();
      document.querySelector<HTMLElement>('.folder-explorer')!.focus();
      return true;
    }
  }
  return false;
}

/** Whether Quick Preview shows `selector` with its content decoded, and the text it holds. */
function previewState(selector: string, texts: string[]) {
  const root = document.querySelector<HTMLElement>('.quick-preview');
  const content = root?.querySelector(selector);
  const text = root?.innerText ?? '';
  const decoded =
    content instanceof HTMLImageElement
      ? content.complete && content.naturalWidth > 0
      : content instanceof HTMLCanvasElement
        ? content.width > 0
        : content instanceof HTMLMediaElement
          ? content.readyState >= 2 && !root!.querySelector('.media-loading')
          : !!content;
  return {
    ready: decoded && texts.every((expected) => text.includes(expected)),
    error: root?.querySelector<HTMLElement>('.empty-state')?.innerText || '',
    missing: texts.filter((expected) => !text.includes(expected)),
    content: !!content,
    module: root?.querySelector<HTMLElement>('[data-preview-module]')?.dataset.previewModule,
    text: text.slice(0, 600),
  };
}

const app = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
const observations: { path: string; passed: boolean; milliseconds: number }[] = [];
try {
  connection = await app.connect();
  const { evaluate, command } = connection;
  const press = async (key: string, code: string, windowsVirtualKeyCode: number) => {
    for (const type of ['keyDown', 'keyUp'])
      await command('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode });
  };
  await until(
    () => evaluate(countOf('[data-file-path]')),
    (count) => count > 0,
    'format samples listed',
  );
  for (const sample of samples) {
    const file = path.join(files, path.basename(sample.path)),
      started = Date.now();
    assert.ok(await evaluate(pageCall(selectRow, file)), 'Row for ' + sample.path);
    await press(' ', 'Space', 32);
    await until(() => evaluate(exists('.quick-preview')), Boolean, 'Quick Preview ' + sample.path);
    const result = await until(
      () => evaluate(pageCall(previewState, sample.selector, sample.texts ?? [])),
      (value) => value.ready || !!value.error,
      sample.path,
      60_000,
    ).catch(async () => evaluate(pageCall(previewState, sample.selector, sample.texts ?? [])));
    const observation = {
      path: sample.path,
      passed: result.ready,
      milliseconds: Date.now() - started,
    };
    observations.push({ ...observation, ...(result.ready ? {} : result) });
    console.log(result.ready ? 'PASS' : 'FAIL', sample.path, observation.milliseconds + ' ms');
    if (!result.ready) {
      console.log('  ', JSON.stringify(result));
      const shot = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
      await writeFile(
        path.join(
          root,
          'failed-' + path.basename(sample.path).replace(/[^a-zA-Z0-9.-]/g, '-') + '.png',
        ),
        Buffer.from(shot.data, 'base64'),
        { flag: 'wx' },
      );
    }
    await press('Escape', 'Escape', 27);
    await until(
      () => evaluate(exists('.quick-preview')),
      (shown) => !shown,
      'preview closes',
    );
  }
} finally {
  await app.close(connection);
  await writeFile(path.join(root, 'result.json'), JSON.stringify({ root, observations }, null, 2), {
    flag: 'wx',
  });
  console.log('Retained format samples:', root);
}
const failed = observations.filter((observation) => !observation.passed);
console.log(`${observations.length - failed.length} of ${samples.length} samples passed.`);
assert.deepEqual(
  failed.map((observation) => observation.path),
  [],
);
