/** Real preview navigation against an isolated profile. Every fixture is retained. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { CURRENT_STATE_VERSION, type Resource, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { localSamples } from '../../tools/playground/catalog';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { click, exists } from './runtime/page';
import { pageCall } from './runtime/page-function';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary && path.isAbsolute(binary));
const root = await temporaryRoot('viewer-native-preview-lifecycle-');
const folder = path.join(root, 'Files');
const profile = path.join(root, 'Profile');
await Promise.all([mkdir(folder), mkdir(profile)]);
const selected = ['docx', 'xlsx', 'obj', 'mp4', 'json', 'css', 'csv', 'tiff', 'heic', 'exr'];
const samples = await localSamples();
const files = selected.map((extension) => {
  const sample = samples.find((sample) => sample.formats.includes(extension));
  assert.ok(sample);
  return { path: path.join(folder, path.basename(sample.path)), bytes: sample.bytes };
});
for (const file of files) await writeFile(file.path, file.bytes, { flag: 'wx' });
await writeFile(path.join(folder, 'Held payload.bin'), Buffer.alloc(16 * 1024 * 1024, 65), {
  flag: 'wx',
});
const settings = defaultSettings(folder);
settings.hotkey.enabled = false;
settings.providers = [];
const ui = normalizePreferences();
ui.sidebar.inNewPlanes = false;
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'preview-check',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'preview-check',
      name: 'Preview regression',
      roots: ['folder'],
      activePane: 'folder',
      arrangement: {},
      panes: [
        {
          id: 'folder',
          type: 'folder',
          path: folder,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [folder],
          historyIndex: 0,
        },
      ],
    },
  ],
};
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }));
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));

/** Leases a file, and an Office file's document, reporting the phase reached within 5 s. */
async function leasePreview(file: string) {
  const start = performance.now();
  let phase = 'resource';
  const work = (async () => {
    const resource = await window.viewer.resource(file);
    try {
      if (/\.(docx|xlsx)$/.test(resource.entry.name)) {
        phase = 'document';
        await window.viewer.document(resource.id);
      }
      return { phase: 'ready', milliseconds: performance.now() - start };
    } finally {
      await window.viewer.release(resource.id);
    }
  })();
  const timeout = new Promise<{ phase: string; milliseconds: number }>((resolve) =>
    setTimeout(() => resolve({ phase, milliseconds: performance.now() - start }), 5000),
  );
  return Promise.race([work, timeout]);
}

function selectRow(file: string): void {
  const row = [...document.querySelectorAll<HTMLElement>('[data-file-path]')].find(
    (row) => row.dataset.filePath === file,
  );
  if (!row) throw new Error('Missing fixture row');
  row.click();
  row.focus();
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

const previewMarkup = () =>
  document.querySelector('.quick-preview-dialog')?.outerHTML.slice(0, 5000) ??
  document.body.innerText.slice(0, 3000);

/** Opens a document while 16 paused streams of a large file hold their leases. */
async function overlappedPreview(held: string, file: string) {
  const resources: Resource[] = [];
  const responses: Response[] = [];
  try {
    for (let n = 0; n < 16; n++) resources.push(await window.viewer.resource(held));
    responses.push(...(await Promise.all(resources.map((resource) => fetch(resource.url)))));
    const ready = window.viewer.resource(file).then(async (resource) => {
      await window.viewer.document(resource.id);
      await window.viewer.release(resource.id);
      return { phase: 'ready' };
    });
    const starved = new Promise<{ phase: string }>((resolve) =>
      setTimeout(() => resolve({ phase: 'starved' }), 5000),
    );
    return await Promise.race([ready, starved]);
  } finally {
    await Promise.all(responses.map((response) => response.body?.cancel().catch(() => {})));
    await Promise.all(resources.map((resource) => window.viewer.release(resource.id)));
  }
}

const app = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
const observations: unknown[] = [];
try {
  connection = await app.connect();
  const { evaluate, command } = connection;
  await until(() => evaluate(exists('.file-table')), Boolean, 'folder ready');
  for (let index = 0; index < 30; index += 1) {
    const file = files[index % files.length]!;
    const observation = await evaluate(pageCall(leasePreview, file.path));
    observations.push({ index, file: path.basename(file.path), ...observation });
    console.log(JSON.stringify(observations.at(-1)));
    assert.equal(observation.phase, 'ready', 'Every preview request completes without starvation');
  }
  const selectors = [
    '.office-document',
    '.worksheet-tab-list',
    '.model-stage canvas',
    'video',
    '.json-scroll',
    '.code-scroll',
    '.data-viewer',
    '.image-stage img',
    '.image-stage img',
    '.image-stage img',
  ];
  const memory: {
    iteration: number;
    usedSize: number;
    backingStorageSize?: number;
    nodes: number;
    jsEventListeners: number;
  }[] = [];
  for (let index = 0; index < 30; index += 1) {
    const slot = index % files.length;
    const file = files[slot]!;
    const start = performance.now();
    await evaluate(pageCall(selectRow, file.path));
    await command('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: ' ',
      code: 'Space',
      windowsVirtualKeyCode: 32,
    });
    await command('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: ' ',
      code: 'Space',
      windowsVirtualKeyCode: 32,
    });
    if (file.path.endsWith('.docx')) {
      await until(() => evaluate(pageCall(officeViewChoices)), Boolean, 'Office view choices');
      await evaluate(pageCall(pressToolbarButton, 'Reading'));
    }
    try {
      await until(
        () => evaluate(exists('.quick-preview ' + selectors[slot])),
        Boolean,
        `Quick Preview ${path.basename(file.path)}`,
        5000,
      );
    } catch (error) {
      console.log('Preview DOM:', await evaluate(pageCall(previewMarkup)));
      throw error;
    }
    observations.push({
      kind: 'quick-preview',
      index,
      file: path.basename(file.path),
      milliseconds: performance.now() - start,
    });
    console.log(JSON.stringify(observations.at(-1)));
    if (index === 0) {
      for (let step = 1; step <= 30; step += 1) {
        await command('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'ArrowRight',
          code: 'ArrowRight',
          windowsVirtualKeyCode: 39,
        });
        await command('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'ArrowRight',
          code: 'ArrowRight',
          windowsVirtualKeyCode: 39,
        });
        await until(
          () => evaluate(exists('.quick-preview .preview-host')),
          Boolean,
          'stepped preview ready',
          5000,
        );
      }
    }
    await evaluate(click('.quick-preview-dialog [aria-label="Close"]'));
    await until(
      () => evaluate(exists('.quick-preview-dialog')),
      (open) => !open,
      'preview closed',
    );
    await until(
      async () => {
        const result = await command<{ targetInfos: { type: string; url: string }[] }>(
          'Target.getTargets',
        );
        return result.targetInfos.filter(
          (target) => target.type === 'worker' && /(?:mesh|table)\.worker/.test(target.url),
        ).length;
      },
      (count) => count === 0,
      'closed previews release their owned parser workers',
    );
    if (index === 9 || index === 29) {
      await command('HeapProfiler.collectGarbage');
      const heap = await command<{ usedSize: number; backingStorageSize?: number }>(
        'Runtime.getHeapUsage',
      );
      const dom = await command<{ nodes: number; jsEventListeners: number }>(
        'Memory.getDOMCounters',
      );
      memory.push({ iteration: index + 1, ...heap, ...dom });
    }
  }
  assert.equal(memory.length, 2);
  assert.ok(
    memory[1]!.usedSize - memory[0]!.usedSize < 32 * 1024 * 1024,
    'Retained renderer heap stays bounded after warmup',
  );
  assert.ok(
    (memory[1]!.backingStorageSize || 0) - (memory[0]!.backingStorageSize || 0) < 32 * 1024 * 1024,
    'Retained array/string storage stays bounded',
  );
  assert.ok(
    memory[1]!.nodes - memory[0]!.nodes < 1000,
    'Closed previews do not accumulate detached view trees',
  );
  observations.push({ kind: 'retained-memory', snapshots: memory });
  const overlapped = await evaluate(
    pageCall(overlappedPreview, path.join(folder, 'Held payload.bin'), files[0]!.path),
  );
  observations.push({ kind: 'stream-overlap', ...overlapped });
  console.log(JSON.stringify(observations.at(-1)));
  assert.equal(
    overlapped.phase,
    'ready',
    'Foreground preview work must not wait behind paused streams',
  );
} finally {
  await writeFile(path.join(root, 'result.json'), JSON.stringify({ root, observations }, null, 2));
  await app.close(connection);
  console.log('Retained preview evidence:', root);
}
