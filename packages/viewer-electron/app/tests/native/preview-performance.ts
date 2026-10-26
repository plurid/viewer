/** Bounded hidden-window comparison; renderer work, not physical compositor FPS. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await temporaryRoot('viewer-native-preview-performance-');
const files = path.join(root, 'Files'),
  profile = path.join(root, 'Profile');
await Promise.all([mkdir(files), mkdir(profile)]);
const csv =
  'id,name,group,amount,detail\n' +
  Array.from(
    { length: 55000 },
    (_, index) =>
      `${index},Item ${index},Group ${index % 20},${index * 3},Generated detail record ${index}\n`,
  ).join('');
assert.ok(Buffer.byteLength(csv) < 4 * 1024 * 1024);
const parts = ['# Non-overlapping synthetic grid; no textures\n'];
const side = 220;
for (let y = 0; y <= side; y++) for (let x = 0; x <= side; x++) parts.push(`v ${x} ${y} 0\n`);
for (let y = 0; y < side; y++)
  for (let x = 0; x < side; x++) {
    const a = y * (side + 1) + x + 1,
      b = a + 1,
      c = a + side + 1,
      d = c + 1;
    parts.push(`f ${a} ${b} ${c}\nf ${b} ${d} ${c}\n`);
  }
const targets = [
  { name: 'Large table.csv', bytes: csv, selector: '.quick-preview .data-viewer' },
  { name: 'Grid.obj', bytes: parts.join(''), selector: '.quick-preview .model-info' },
];
for (const target of targets)
  await writeFile(path.join(files, target.name), target.bytes, { flag: 'wx' });
const settings = defaultSettings(files);
settings.hotkey.enabled = false;
settings.providers = [];
const ui = normalizePreferences();
ui.sidebar.inNewPlanes = false;
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'performance',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'performance',
      name: 'Preview performance',
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
const app = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
const observations: unknown[] = [];
try {
  connection = await app.connect();
  const { evaluate, command } = connection;
  await command('Performance.enable');
  await until(
    () => evaluate<number>('document.querySelectorAll("[data-file-path]").length'),
    (count) => count === targets.length,
    'performance fixtures',
  );
  for (const target of targets)
    for (let trial = 0; trial < 3; trial++) {
      await evaluate(`(() => {
      window.__previewLongTasks = [];
      window.__previewObserver?.disconnect();
      window.__previewObserver = new PerformanceObserver(list => window.__previewLongTasks.push(...list.getEntries().map(entry => entry.duration)));
      window.__previewObserver.observe({type: 'longtask'});
      const row = document.querySelector(${JSON.stringify(`[data-file-path="${path.join(files, target.name)}"]`)});
      row.click(); document.querySelector('.folder-explorer').focus();
    })()`);
      const before = await command<{ metrics: { name: string; value: number }[] }>(
        'Performance.getMetrics',
      );
      const start = performance.now();
      for (const type of ['keyDown', 'keyUp'])
        await command('Input.dispatchKeyEvent', {
          type,
          key: ' ',
          code: 'Space',
          windowsVirtualKeyCode: 32,
        });
      await until(
        () =>
          evaluate<boolean>(`(() => {
      const element = document.querySelector(${JSON.stringify(target.selector)});
      return !!element && !document.querySelector('.quick-preview .loading') &&
        ${target.name.endsWith('.obj') ? "element.textContent.includes('triangles')" : "element.textContent.includes('rows')"};
    })()`),
        Boolean,
        target.name + ' rendered',
        20000,
      );
      await evaluate(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
      const tasks = await evaluate<number[]>('window.__previewLongTasks');
      const after = await command<{ metrics: { name: string; value: number }[] }>(
        'Performance.getMetrics',
      );
      const deltas = Object.fromEntries(
        ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'].map((name) => [
          name,
          1000 *
            ((after.metrics.find((metric) => metric.name === name)?.value || 0) -
              (before.metrics.find((metric) => metric.name === name)?.value || 0)),
        ]),
      );
      const result = {
        file: target.name,
        bytes: Buffer.byteLength(target.bytes),
        trial,
        milliseconds: performance.now() - start,
        maximumLongTask: Math.max(0, ...tasks),
        longTasks: tasks,
        deltas,
      };
      observations.push(result);
      console.log(JSON.stringify(result));
      if (target.name.endsWith('.csv')) {
        await evaluate(`(() => {
          window.__previewLongTasks = [];
          document.querySelector('[aria-label="Filter table rows"]').focus();
          window.__filterMilliseconds = undefined;
          const start = performance.now();
          const root = document.querySelector('.quick-preview .data-viewer');
          const observer = new MutationObserver(() => {
            const count = root.querySelector('.preview-toolbar .muted')?.textContent || '';
            if (count.startsWith('1 rows')) {
              window.__filterMilliseconds = performance.now() - start;
              observer.disconnect();
            }
          });
          observer.observe(root, {subtree: true, childList: true, characterData: true});
        })()`);
        const filterStart = performance.now();
        await command('Input.insertText', { text: 'Generated detail record 54999' });
        await until(
          () =>
            evaluate<boolean>(
              'document.querySelector(".quick-preview .data-viewer").textContent.includes("1 rows")',
            ),
          Boolean,
          'filtered source row',
        );
        const tasks = await evaluate<number[]>('window.__previewLongTasks');
        const rendererMilliseconds = await evaluate<number>('window.__filterMilliseconds');
        const filtered = {
          file: target.name,
          trial,
          kind: 'filter',
          rendererMilliseconds,
          milliseconds: performance.now() - filterStart,
          maximumLongTask: Math.max(0, ...tasks),
          longTasks: tasks,
        };
        observations.push(filtered);
        console.log(JSON.stringify(filtered));
      }
      await evaluate(
        'document.querySelector(\'.quick-preview-dialog [aria-label="Close"]\').click()',
      );
      await until(
        () => evaluate<boolean>('!document.querySelector(".quick-preview-dialog")'),
        Boolean,
        'preview closes',
      );
      await command('HeapProfiler.collectGarbage');
    }
  await app.close(connection);
  connection = undefined;
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify({ pass: true, binary, observations }, null, 2),
    { flag: 'wx' },
  );
  console.log('Preview performance evidence retained:', root);
} catch (error) {
  await writeFile(
    path.join(root, 'failure.json'),
    JSON.stringify({ error: String(error), observations }, null, 2),
    { flag: 'wx' },
  );
  throw error;
} finally {
  if (connection) await app.close(connection);
}
