/** Public and generated Office files through the packaged UI. Retain every copy/capture. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { officeLayoutSamples } from '../../tools/playground/office-layout';
import { qualificationSamples } from '../../tools/playground/qualification-samples';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { officeFontFixture } from '../fixtures/office-fonts';
import { focus, textOf } from './runtime/page';
import { pageCall } from './runtime/page-function';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
const corpus = process.env.VIEWER_TEST_OFFICE_CORPUS;
assert.ok(binary && corpus, 'Provide the packaged binary and retained public corpus.');
const root = await temporaryRoot('viewer-native-office-layout-');
const names = [
  'FloatingPictures.doc',
  'VariousPictures.docx',
  'ConditionalFormattingSamples.xls',
  'ConditionalFormattingSamples.xlsx',
  'SampleShow.ppt',
  'ArtisticEffectSample.pptx',
  'chart-picture-bg.pptx',
  'saut_page.docx',
  'Regional serif and sans.docx',
];
const requested = new Set(process.argv.slice(2));
for (const name of requested) assert.ok(names.includes(name), 'Unknown Office sample: ' + name);
const observations: unknown[] = [];
const hash = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
type Connection = Awaited<ReturnType<Awaited<ReturnType<typeof ownedApp>>['connect']>>;

/** The page canvas, how many of every fourth pixel carry ink, the page count and any error. */
function paintedPage() {
  const canvas = document.querySelector<HTMLCanvasElement>('.pdf-sheet canvas');
  const input = document.querySelector<HTMLInputElement>('.page-number');
  const error = document.querySelector('[data-office-layout] .empty-state')?.textContent;
  if (!canvas?.width || !input) return { width: 0, height: 0, ink: 0, pages: 0, error };
  const bytes = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  let ink = 0;
  for (let index = 0; index < bytes.length; index += 16)
    if (bytes[index + 3] && Math.min(bytes[index]!, bytes[index + 1]!, bytes[index + 2]!) < 235)
      ink++;
  return { width: canvas.width, height: canvas.height, ink, pages: Number(input.max), error };
}

function officeViewChoices(): boolean {
  return [...document.querySelectorAll('.preview-toolbar button')].some((button) =>
    ['Layout', 'Print layout', 'Reading', 'Sheet'].includes(button.textContent.trim()),
  );
}

function pressToolbarButton(label: string): void {
  [...document.querySelectorAll<HTMLElement>('.preview-toolbar button')]
    .find((button) => button.textContent.trim() === label)!
    .click();
}

const worksheetNames = () =>
  [...document.querySelectorAll('.worksheet-tabs [role=tab]')].map((tab) => tab.textContent);

/** Lays the file out again, warm, and returns the PDF as base64 with its timing. */
async function warmLayout(file: string) {
  const parent = await window.viewer.resource(file);
  try {
    const start = performance.now();
    const output = await window.viewer.officeLayout(parent.id, { requestID: crypto.randomUUID() });
    const bytes = new Uint8Array(await (await fetch(output.url)).arrayBuffer());
    let content = '';
    for (let index = 0; index < bytes.length; index += 32768)
      content += String.fromCharCode(...bytes.subarray(index, index + 32768));
    return {
      milliseconds: performance.now() - start,
      bytes: bytes.byteLength,
      kind: output.derivation?.kind,
      pdf: btoa(content),
    };
  } finally {
    await window.viewer.release(parent.id);
  }
}

async function painted(connection: Connection) {
  return until(
    () => connection.evaluate(pageCall(paintedPage)),
    (value) => {
      if (value.error) throw Error(value.error);
      return value.ink > 30;
    },
    'Rendered Office pixels',
    55000,
  );
}

try {
  for (const name of names.filter((name) => !requested.size || requested.has(name))) {
    const file = path.join(root, name);
    const generated = name === 'Regional serif and sans.docx' ? officeFontFixture() : undefined;
    if (generated) await writeFile(file, generated, { flag: 'wx' });
    else await copyFile(path.join(corpus!, name), file, 1);
    const before = await hash(file);
    const reference = [...officeLayoutSamples, ...qualificationSamples].find((sample) =>
      decodeURIComponent(new URL(sample.url).pathname).endsWith('/' + name),
    );
    if (generated) assert.equal(before, createHash('sha256').update(generated).digest('hex'));
    else {
      assert.ok(reference, 'Pinned public reference: ' + name);
      assert.equal(before, reference.sha256, 'Pinned input bytes: ' + name);
    }
    const profile = path.join(root, name + '-Profile');
    await mkdir(profile);
    const settings = defaultSettings(root),
      ui = normalizePreferences();
    settings.hotkey.enabled = false;
    settings.providers = [];
    const state: SavedState = {
      version: CURRENT_STATE_VERSION,
      look: 'dark',
      ui,
      favorites: [],
      recents: [],
      activeWorkspace: 'office',
      workspaces: [
        {
          id: 'office',
          name: 'Office layout qualification',
          roots: ['document'],
          activePane: 'document',
          arrangement: {},
          layout: {
            placements: [
              {
                id: 'document',
                width: 1200,
                height: 780,
                show: true,
                location: { translateX: 0, translateY: 0, translateZ: 0, rotateX: 0, rotateY: 0 },
              },
            ],
            active: 'document',
            docked: 'document',
          },
          panes: [{ id: 'document', type: 'preview', path: file }],
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
    const app = await ownedApp(binary!, profile);
    let connection: Connection | undefined;
    const started = performance.now();
    try {
      connection = await app.connect();
      const { evaluate, command } = connection;
      await command('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 940,
        deviceScaleFactor: 1,
        mobile: false,
      });
      if (name.endsWith('.xlsx')) {
        await until(() => evaluate(pageCall(officeViewChoices)), Boolean, 'Office mode controls');
        await evaluate(pageCall(pressToolbarButton, 'Print layout'));
      }
      const first = await painted(connection);
      const firstText = await evaluate(textOf('.textLayer'));
      const loadMilliseconds = performance.now() - started;
      const screenshot = await command<{ data: string }>('Page.captureScreenshot', {
        format: 'png',
      });
      await writeFile(path.join(root, name + '.png'), Buffer.from(screenshot.data, 'base64'), {
        flag: 'wx',
      });
      let sheets: string[] = [];
      if (/\.xlsx?$/.test(name)) {
        sheets = await evaluate(pageCall(worksheetNames));
        assert.ok(sheets.length > 1, 'Public workbook has navigable worksheets');
        await evaluate(focus('.worksheet-tabs [role=tab]'));
        for (const type of ['keyDown', 'keyUp'])
          await command('Input.dispatchKeyEvent', {
            type,
            key: 'ArrowRight',
            code: 'ArrowRight',
            windowsVirtualKeyCode: 39,
          });
        await until(
          () => evaluate(textOf('.worksheet-tabs [aria-selected=true]')),
          (text) => text === sheets[1],
          'Selected second worksheet',
        );
        await painted(connection);
        const secondText = await evaluate(textOf('.textLayer'));
        assert.notEqual(secondText, firstText, 'Changing sheets changes rendered source content');
        assert.equal(
          await evaluate(pageCall(() => document.activeElement?.textContent)),
          sheets[1],
        );
      }
      const warm = await evaluate(pageCall(warmLayout, file));
      assert.equal(warm.kind, 'office');
      assert.ok(warm.bytes > 100);
      const { pdf, ...warmTiming } = warm;
      await writeFile(path.join(root, name + '.viewer.pdf'), Buffer.from(pdf, 'base64'), {
        flag: 'wx',
      });
      if (name === 'FloatingPictures.doc') {
        const task = getDocument({ data: new Uint8Array(Buffer.from(pdf, 'base64')) });
        try {
          const document = await task.promise;
          const page = await document.getPage(7);
          const text = (await page.getTextContent()).items
            .map((item) => ('str' in item ? item.str : ''))
            .join('');
          assert.ok(
            text.includes(name) && !text.includes('input.doc'),
            'Filename fields show the actual source basename instead of the helper input name.',
          );
          assert.ok(
            text.includes(
              '文京区と目黒区。総長の挨拶、入学案内、学部や研究所組織、附属施設のサイトへのリンク。',
            ),
            'Bundled CJK fonts preserve the actual Japanese text instead of repeated missing glyphs.',
          );
        } finally {
          await task.destroy();
        }
      }
      if (generated) {
        const visible = await evaluate(textOf('.textLayer'));
        assert.ok(visible.includes('日本語の明朝体'));
        assert.ok(visible.includes('한국어 고딕체'));
        const bytes = Buffer.from(pdf, 'base64');
        assert.ok(bytes.includes(Buffer.from('NotoSerifCJKjp-Regular')));
        assert.ok(bytes.includes(Buffer.from('NotoSansCJKkr-Regular')));
      }
      // Each conversion warms one spare engine for the next document (office-renderer.ts); any
      // more would be engines left behind.
      const targets = await command<{ targetInfos: { url: string }[] }>('Target.getTargets');
      const engines = targets.targetInfos.filter((t) =>
        /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{48}\/$/.test(t.url),
      ).length;
      assert.ok(engines <= 1, `Conversion engines terminate; only the spare stays (${engines})`);
      assert.equal(await hash(file), before, 'Source bytes preserved');
      observations.push({
        name,
        sourceHash: before,
        ...first,
        loadMilliseconds,
        warm: warmTiming,
        sheets,
      });
      console.log(
        'Office reference passed:',
        name,
        Math.round(loadMilliseconds) + ' ms',
        first.pages + ' pages',
      );
    } catch (error) {
      if (connection) {
        await writeFile(
          path.join(root, name + '-failure.txt'),
          await connection.evaluate(pageCall(() => document.body.innerText)),
          { flag: 'wx' },
        );
        const image = await connection.command<{ data: string }>('Page.captureScreenshot', {
          format: 'png',
        });
        await writeFile(path.join(root, name + '-failure.png'), Buffer.from(image.data, 'base64'), {
          flag: 'wx',
        });
      }
      throw error;
    } finally {
      await app.close(connection);
    }
  }
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify({ passed: true, observations }, null, 2) + '\n',
    { flag: 'wx' },
  );
  console.log('Public Office qualification passed; retained fixture:', path.basename(root));
} catch (error) {
  await writeFile(
    path.join(root, 'failure.json'),
    JSON.stringify({ passed: false, observations, error: String(error) }, null, 2) + '\n',
    { flag: 'wx' },
  );
  throw error;
}
