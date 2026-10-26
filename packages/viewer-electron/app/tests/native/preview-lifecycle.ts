/** Real preview navigation against an isolated profile. Every fixture is retained. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { localSamples } from '../../tools/playground/catalog';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';

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
const app = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
const observations: unknown[] = [];
try {
  connection = await app.connect();
  const { evaluate, command } = connection;
  await until(
    () => evaluate<boolean>('!!document.querySelector(".file-table")'),
    Boolean,
    'folder ready',
  );
  for (let index = 0; index < 30; index += 1) {
    const file = files[index % files.length]!;
    const observation = await evaluate<{ phase: string; milliseconds: number }>(`(async () => {
      const start = performance.now();
      let phase = 'resource';
      const work = (async () => {
        const resource = await window.viewer.resource(${JSON.stringify(file.path)});
        try {
          if (/\\.(docx|xlsx)$/.test(resource.entry.name)) {
            phase = 'document';
            await window.viewer.document(resource.id);
          }
          return { phase: 'ready', milliseconds: performance.now() - start };
        } finally { await window.viewer.release(resource.id); }
      })();
      return Promise.race([work, new Promise(resolve => setTimeout(() => resolve({ phase, milliseconds: performance.now() - start }), 5000))]);
    })()`);
    observations.push({ index, file: path.basename(file.path), ...observation });
    console.log(JSON.stringify(observations.at(-1)));
    assert.equal(observation.phase, 'ready', 'Every preview request completes without starvation');
  }
  const selectors = [
    '.office-document',
    '.workbook-sheet-picker',
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
    await evaluate(`(() => {
      const row = [...document.querySelectorAll('[data-file-path]')].find(row => row.dataset.filePath === ${JSON.stringify(file.path)});
      if (!row) throw new Error('Missing fixture row');
      row.click();
      row.focus();
    })()`);
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
    try {
      await until(
        () =>
          evaluate<boolean>(
            `!!document.querySelector(${JSON.stringify('.quick-preview ' + selectors[slot])})`,
          ),
        Boolean,
        `Quick Preview ${path.basename(file.path)}`,
        5000,
      );
    } catch (error) {
      console.log(
        'Preview DOM:',
        await evaluate(
          'document.querySelector(".quick-preview-dialog")?.outerHTML.slice(0,5000) ?? document.body.innerText.slice(0,3000)',
        ),
      );
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
          () => evaluate<boolean>('!!document.querySelector(".quick-preview .preview-host")'),
          Boolean,
          'stepped preview ready',
          5000,
        );
      }
    }
    await evaluate(
      'document.querySelector(\'.quick-preview-dialog [aria-label="Close"]\').click()',
    );
    await until(
      () => evaluate<boolean>('!document.querySelector(".quick-preview-dialog")'),
      Boolean,
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
  const overlapped = await evaluate<{ phase: string }>(`(async () => {
    const resources = [];
    const responses = [];
    try {
      for (let n = 0; n < 16; n++) resources.push(await window.viewer.resource(${JSON.stringify(path.join(folder, 'Held payload.bin'))}));
      responses.push(...await Promise.all(resources.map(resource => fetch(resource.url))));
      const ready = window.viewer.resource(${JSON.stringify(files[0]!.path)}).then(async resource => {
        await window.viewer.document(resource.id);
        await window.viewer.release(resource.id);
        return { phase: 'ready' };
      });
      return await Promise.race([ready, new Promise(resolve => setTimeout(() => resolve({ phase: 'starved' }), 5000))]);
    } finally {
      await Promise.all(responses.map(response => response.body?.cancel().catch(() => {})));
      await Promise.all(resources.map(resource => window.viewer.release(resource.id)));
    }
  })()`);
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
