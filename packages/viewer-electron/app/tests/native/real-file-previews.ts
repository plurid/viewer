/** Public application-authored documents and original photography/media. This
 * qualifies the recorded samples and limits, not every file with the extension. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { qualificationSamples } from '../../tools/playground/qualification-samples';
import { remoteSamples } from '../../tools/playground/catalog';
import { defaultPlaygroundDirectory } from '../../tools/playground/main';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { countOf, exists, pressButton } from './runtime/page';
import { pageCall } from './runtime/page-function';
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const corpusDirectory = path.resolve(
  process.env.VIEWER_TEST_REAL_CORPUS ?? defaultPlaygroundDirectory,
);
const previewSelectors = new Map([
  ['docx', '.office-document'],
  ['xlsx', '.worksheet-tab-list'],
  ['pptx', '.pdf-sheet canvas'],
  ['pdf', '.pdf-sheet canvas'],
  ['dng', '.image-stage img'],
  ['nef', '.image-stage img'],
]);
const root = await temporaryRoot('viewer-native-real-files-'),
  files = path.join(root, 'Files'),
  profile = path.join(root, 'Profile');
await Promise.all([mkdir(files), mkdir(profile)]);
const corpus = [
  ...qualificationSamples.filter(
    (sample) => sample.formats.length && !sample.formats.includes('epub'),
  ),
  ...remoteSamples.filter((sample) =>
    sample.formats.some((extension) => ['dng', 'nef', 'ogv'].includes(extension)),
  ),
];
const hash = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
for (const sample of corpus) {
  const source = path.join(corpusDirectory, sample.path),
    destination = path.join(files, path.basename(sample.path));
  const info = await lstat(source);
  assert.ok(info.isFile() && !info.isSymbolicLink());
  assert.equal(info.size, sample.size);
  assert.equal(await hash(source), sample.sha256);
  await copyFile(source, destination, 1);
  assert.equal(await hash(destination), sample.sha256);
}
const settings = defaultSettings(files),
  ui = normalizePreferences();
settings.hotkey.enabled = false;
settings.providers = [];
ui.sidebar.inNewPlanes = false;
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'qualification',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'qualification',
      name: 'Real-file qualification',
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

/** Reads the document through a fresh resource lease and summarises its Office content. */
async function inspectDocument(file: string) {
  const start = performance.now(),
    resource = await window.viewer.resource(file);
  try {
    const value = await window.viewer.document(resource.id),
      office = value.office;
    return {
      ms: performance.now() - start,
      kind: office?.kind,
      blocks: office?.kind === 'word' ? office.blocks.length : undefined,
      sheets:
        office?.kind === 'workbook'
          ? office.sheets.map((sheet) => ({
              name: sheet.name,
              rows: sheet.rows.length,
              columns: sheet.columns,
              truncated: sheet.truncated,
            }))
          : undefined,
      truncated: value.truncated,
      coverage: value.coverageReason,
      characters: value.text.length,
    };
  } finally {
    await window.viewer.release(resource.id);
  }
}

function selectRow(row: string): void {
  document.querySelector<HTMLElement>(row)!.click();
  document.querySelector<HTMLElement>('.folder-explorer')!.focus();
}

function officeViewChoices(): boolean {
  return [...document.querySelectorAll('.preview-toolbar button')].some((button) =>
    ['Layout', 'Print layout', 'Reading', 'Sheet'].includes(button.textContent.trim()),
  );
}

/** Whether `selector` shows decoded content, plus any error, warning and decoded dimensions. */
function previewState(selector: string) {
  const root = document.querySelector('.quick-preview');
  const image = root?.querySelector<HTMLImageElement>('.image-stage img');
  const media = root?.querySelector<HTMLVideoElement | HTMLAudioElement>('video,audio');
  const canvas = root?.querySelector<HTMLCanvasElement>('.pdf-sheet canvas');
  const content = root?.querySelector(selector);
  const mediaReady = !!media && media.readyState >= 2;
  return {
    ready:
      !!content &&
      (!image || (image.complete && image.naturalWidth > 0)) &&
      (!canvas || canvas.width > 0) &&
      (!media || (mediaReady && !root!.querySelector('.media-loading'))),
    error: root?.querySelector<HTMLElement>('.empty-state')?.innerText || '',
    warning: root?.querySelector('.inline-warning')?.textContent || '',
    // An audio element has no picture size, so audio-only media reports none.
    media:
      media && mediaReady
        ? {
            duration: media.duration,
            width: 'videoWidth' in media ? media.videoWidth : undefined,
            height: 'videoHeight' in media ? media.videoHeight : undefined,
          }
        : undefined,
    image: image?.complete ? { width: image.naturalWidth, height: image.naturalHeight } : undefined,
  };
}

const pageDelay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const app = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
const observations: unknown[] = [];
let passed = false;
try {
  connection = await app.connect();
  const { evaluate, command } = connection;
  const press = async (key: string, code: string, windowsVirtualKeyCode: number) => {
    for (const type of ['keyDown', 'keyUp'])
      await command('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode });
  };
  const capture = async (name: string) => {
    await evaluate(pageCall(pageDelay, 300));
    const value = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(root, name + '.png'), Buffer.from(value.data, 'base64'), {
      flag: 'wx',
    });
  };
  await until(
    () => evaluate(countOf('[data-file-path]')),
    (count) => count === corpus.length,
    'public qualification corpus',
  );
  for (const sample of corpus) {
    const file = path.join(files, path.basename(sample.path)),
      extension = sample.formats[0]!,
      started = Date.now();
    const expectedRejection = sample.path.endsWith('poi-deep-data.xlsx')
      ? 'ZIP directory was not found'
      : undefined;
    if (['docx', 'xlsx'].includes(extension)) {
      const read = () => evaluate(pageCall(inspectDocument, file));
      if (expectedRejection) {
        await assert.rejects(read, (error: Error) => error.message.includes(expectedRejection));
        observations.push({
          file: sample.path,
          inspection: 'bounded refusal',
          reason: expectedRejection,
        });
      } else {
        const cold = await read(),
          warm = await read();
        observations.push({ file: sample.path, cold, warm });
        assert.ok(cold.characters > 0);
        if (sample.path.endsWith('poi-large-workbook.xlsx')) {
          assert.equal(cold.truncated, true);
          const sheets = cold.sheets!;
          assert.equal(sheets.length, 2);
          assert.equal(sheets[0].name, 'Documents Per Project');
          assert.ok(sheets[0].rows > 0 && sheets[0].rows <= 2000);
          assert.ok(sheets[0].columns > 0 && sheets[0].columns <= 256);
          assert.equal(sheets[0].truncated, true);
        }
      }
    }
    await evaluate(pageCall(selectRow, `[data-file-path="${file}"]`));
    await press(' ', 'Space', 32);
    await until(() => evaluate(exists('.quick-preview')), Boolean, 'Quick Preview ' + extension);
    if (extension === 'docx') {
      await until(() => evaluate(pageCall(officeViewChoices)), Boolean, 'Office view choices');
      await evaluate(pressButton('Reading', '.preview-toolbar'));
    }
    const result = await until(
      () => evaluate(pageCall(previewState, previewSelectors.get(extension) ?? 'video,audio')),
      (value) => value.ready || value.error,
      'decoded ' + extension,
      20000,
    );
    if (expectedRejection) {
      assert.ok(result.error.includes(expectedRejection));
      assert.equal(result.ready, false);
    } else if (['docx', 'xlsx', 'pptx', 'pdf'].includes(extension))
      assert.equal(result.error, '', extension + ' content opens');
    if (extension === 'pdf')
      assert.equal(
        (await evaluate(pageCall((file: string) => window.viewer.pdfInspect(file), file))).pages,
        178,
      );
    if (result.ready && result.media && !result.media.width) {
      assert.ok(result.warning.includes('No video picture'));
      await evaluate(
        pageCall(() => document.querySelector<HTMLAudioElement>('.quick-preview audio')!.play()),
      );
      await until(
        () =>
          evaluate(
            pageCall(
              () => document.querySelector<HTMLAudioElement>('.quick-preview audio')!.currentTime,
            ),
          ),
        (seconds) => seconds > 0.15,
        'partial video audio actually advances',
        5000,
      );
      await evaluate(
        pageCall(() => document.querySelector<HTMLAudioElement>('.quick-preview audio')!.pause()),
      );
    }
    observations.push({
      file: sample.path,
      milliseconds: Date.now() - started,
      preview: result.ready
        ? result.media && !result.media.width
          ? 'audio only; no video picture'
          : 'rendered'
        : 'explicit unsupported/decoder error',
      ...result,
    });
    console.log('Real-file preview:', JSON.stringify(observations.at(-1)));
    await capture('preview-' + path.basename(sample.path).replace(/[^a-zA-Z0-9.-]/g, '-'));
    await press('Escape', 'Escape', 27);
    await until(
      () => evaluate(exists('.quick-preview')),
      (shown) => !shown,
      'preview closes',
    );
  }
  assert.equal((await evaluate(pageCall(() => window.viewer.jobs()))).length, 0);
  for (const sample of corpus) {
    assert.equal(await hash(path.join(corpusDirectory, sample.path)), sample.sha256);
    assert.equal(await hash(path.join(files, path.basename(sample.path))), sample.sha256);
  }
  passed = true;
  console.log('Real-file qualification passed:', root);
} catch (error) {
  if (connection)
    console.log(
      'Qualification surface:',
      await connection.evaluate(pageCall(() => document.body.innerText.slice(-5000))),
    );
  throw error;
} finally {
  await app.close(connection);
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      {
        passed,
        root,
        observations,
        corpus: corpus.map(({ path, sha256, size, license }) => ({ path, sha256, size, license })),
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  console.log('Retained real-file qualification:', root);
}
