/** Cold and warm document navigation through fresh resource leases; fixtures stay on disk. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { strToU8 } from 'fflate';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import type { SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { localSamples } from '../../tools/playground/catalog';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { click, countOf, exists, textOf } from './runtime/page';
import { pageCall } from './runtime/page-function';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const cycles = Number(process.env.VIEWER_TEST_NAVIGATION_CYCLES ?? 30);
assert.ok(Number.isInteger(cycles) && cycles >= 1 && cycles <= 50);
const root = await temporaryRoot('viewer-document-navigation-');
const files = path.join(root, 'Files');
const profile = path.join(root, 'Profile');
await Promise.all([mkdir(files), mkdir(profile)]);
const samples = await localSamples();
const sample = (format: string) => {
  const found = samples.find((item) => item.formats.includes(format));
  assert.ok(found);
  return typeof found.bytes === 'string' ? strToU8(found.bytes) : found.bytes;
};
const fixtures = {
  'Book.epub': sample('epub'),
  'Workbook.xlsx': sample('xlsx'),
  'Other.txt': strToU8('A different file between document visits.'),
};
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
for (const [name, bytes] of Object.entries(fixtures))
  await writeFile(path.join(files, name), bytes, { flag: 'wx' });
const settings = defaultSettings(files);
settings.hotkey.enabled = false;
settings.providers = [];
const ui = normalizePreferences();
ui.space.opening = 'dock';
ui.sidebar.inNewPlanes = false;
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'navigation',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'navigation',
      name: 'Document navigation acceptance',
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
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
});
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), { flag: 'wx' });

interface ReadyWindow {
  __documentReadyMilliseconds: number | null;
}

/** Selects `row` and times, from now, the frame after `ready` shows without a spinner. */
function armDocumentTiming(row: string, ready: string): void {
  const element = document.querySelector<HTMLElement>(row)!;
  element.click();
  element.focus();
  const page = window as unknown as ReadyWindow;
  page.__documentReadyMilliseconds = null;
  const started = performance.now();
  const observer = new MutationObserver(() => {
    if (!document.querySelector(ready) || document.querySelector('.quick-preview-dialog .loading'))
      return;
    observer.disconnect();
    requestAnimationFrame(() => {
      page.__documentReadyMilliseconds = performance.now() - started;
    });
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
}

const documentReadyMilliseconds = () =>
  (window as unknown as ReadyWindow).__documentReadyMilliseconds;

const app = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
const observations: { file: string; trial: number; milliseconds: number }[] = [];
let passed = false;
try {
  connection = await app.connect();
  const { evaluate, command } = connection;
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await until(
    () => evaluate(countOf('[data-file-path]')),
    (count) => count === 3,
    'Generated document rows',
  );
  const key = async (key: string, code: string, virtual: number) => {
    for (const type of ['keyDown', 'keyUp'])
      await command('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: virtual });
  };
  const open = async (name: string, selector: string) => {
    await evaluate(
      pageCall(
        armDocumentTiming,
        `[data-file-path="${path.join(files, name)}"]`,
        '.quick-preview-dialog ' + selector,
      ),
    );
    await key(' ', 'Space', 32);
    return until(
      () => evaluate(pageCall(documentReadyMilliseconds)),
      (value) => typeof value === 'number',
      'Document ready ' + name,
      20000,
    );
  };
  const close = async () => {
    await key('Escape', 'Escape', 27);
    await until(
      () => evaluate(exists('.quick-preview-dialog')),
      (shown) => !shown,
      'Quick Preview closed',
    );
  };
  for (const target of [
    {
      file: 'Book.epub',
      selector: '.epub-chapter',
      select: '.epub-viewer [aria-label="Next chapter"]',
      restored: '.epub-viewer nav button[aria-current="page"]',
      expected: 'Keep context',
    },
    {
      file: 'Workbook.xlsx',
      selector: '.data-scroll',
      select: '.worksheet-tab-list [role="tab"]:last-child',
      restored: '.worksheet-tab-list [aria-selected="true"]',
      expected: 'Notes',
    },
  ]) {
    const cold = await open(target.file, target.selector);
    observations.push({ file: target.file, trial: 0, milliseconds: cold! });
    await evaluate(click(target.select));
    await until(
      () => evaluate(textOf(target.restored)),
      (text) => text.trim() === target.expected,
      'Changed document position',
    );
    await close();
    for (let trial = 1; trial <= cycles; trial++) {
      await open('Other.txt', '.code-scroll');
      await close();
      const milliseconds = await open(target.file, target.selector);
      const restored = await evaluate(textOf(target.restored));
      assert.equal(restored.trim(), target.expected, 'Retained chapter or worksheet');
      observations.push({ file: target.file, trial, milliseconds: milliseconds! });
      await close();
    }
    const warm = observations
      .filter((value) => value.file === target.file && value.trial > 0)
      .map((value) => value.milliseconds)
      .sort((a, b) => a - b);
    const result = {
      file: target.file,
      cold,
      cycles,
      median: warm[Math.floor(warm.length / 2)],
      p95: warm[Math.ceil(warm.length * 0.95) - 1],
    };
    console.log(JSON.stringify(result));
    if (process.env.VIEWER_TEST_WARM_BUDGET_MS)
      assert.ok(
        result.p95! <= Number(process.env.VIEWER_TEST_WARM_BUDGET_MS),
        'Warm document navigation budget',
      );
  }
  passed = true;
} finally {
  await app.close(connection);
  for (const [name, bytes] of Object.entries(fixtures))
    assert.equal(
      digest(await readFile(path.join(files, name))),
      digest(bytes),
      'Fixture retained unchanged',
    );
  await writeFile(
    path.join(root, 'results.json'),
    JSON.stringify({ passed, observations }, null, 2),
    { flag: 'wx' },
  );
  console.log(JSON.stringify({ passed, evidence: path.basename(root) + '/results.json' }));
}
