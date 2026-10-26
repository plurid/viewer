/** Mixed-plane acceptance. Owns its app, loopback page and retained fixtures. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { closeSync, openSync, writeSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import { CURRENT_STATE_VERSION, type Pane, type SavedState } from '../../src/domain/contracts';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { defaultSettings } from '../../src/domain/services';
import { localSamples } from '../../tools/playground/catalog';
import { temporaryRoot } from '../../tools/temporary';
import { modelHeapSummary } from '../../tools/qualification/heap';
import { ownedApp, until } from '../owned-app';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary && path.isAbsolute(binary));
const cycleCount = Number(process.env.VIEWER_MIXED_CYCLES ?? 3);
assert.ok(Number.isInteger(cycleCount) && cycleCount >= 3 && cycleCount <= 50);
const captureHeaps = process.env.VIEWER_MIXED_HEAPS === '1';
const root = await temporaryRoot('viewer-native-mixed-workspaces-');
const files = path.join(root, 'Files');
const profile = path.join(root, 'Profile');
await Promise.all([mkdir(files), mkdir(profile)]);

let pageRequests = 0;
const server = createServer((_request, response) => {
  pageRequests += 1;
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(
    '<!doctype html><title>Generated workspace page</title><h1>Local browser fixture</h1><p>No external resources.</p><input aria-label="Fixture input"><button onclick="this.textContent=\'Clicked\'">Try</button>',
  );
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const url = `http://127.0.0.1:${address.port}/`;
const panes: Pane[] = [];
for (let index = 0; index < 4; index += 1) {
  const directory = path.join(files, `Folder ${index + 1}`);
  await mkdir(directory);
  await Promise.all(
    Array.from({ length: 120 }, (_, item) =>
      writeFile(
        path.join(directory, `Generated ${String(item).padStart(3, '0')}.txt`),
        `Fixture ${item}\n`,
        { flag: 'wx' },
      ),
    ),
  );
  panes.push({
    id: `folder-${index}`,
    type: 'folder',
    path: directory,
    mode: 'list',
    sort: 'name',
    descending: false,
    showHidden: false,
    history: [directory],
    historyIndex: 0,
    sidebar: { visible: false, width: 210 },
  });
}
const samples = await localSamples();
const material = samples.find((sample) => sample.path.endsWith('/Reference block.mtl'));
assert.ok(material);
await writeFile(path.join(files, path.basename(material.path)), material.bytes, { flag: 'wx' });
const formats = [
  'pdf',
  'epub',
  'docx',
  'xlsx',
  'json',
  'csv',
  'obj',
  'glb',
  'stl',
  'mp4',
  'wav',
  'png',
];
for (const [index, format] of formats.entries()) {
  const sample = samples.find((item) => item.formats.includes(format));
  assert.ok(sample, 'Generated sample: ' + format);
  const file = path.join(files, path.basename(sample.path));
  await writeFile(file, sample.bytes, { flag: 'wx' });
  panes.push({ id: `preview-${index}`, type: 'preview', path: file });
}
for (let index = 0; index < 2; index += 1) {
  panes.push({
    id: `browser-${index}`,
    type: 'browser',
    path: files,
    url,
    title: 'Generated browser',
  });
  panes.push({
    id: `terminal-${index}`,
    type: 'terminal',
    path: files,
    profileID: 'fixture-shell',
    startOnOpen: true,
  });
}
assert.equal(panes.length, 20);
const settings = defaultSettings(files);
settings.hotkey.enabled = false;
settings.providers = [];
settings.terminals.profiles = [
  // The built-in own-shell route needs no custom-program approval. No login
  // argument: the generated fixture must not source the person's startup files.
  { id: 'fixture-shell', name: 'Generated shell', executable: '', args: [], env: {} },
];
settings.terminals.profileID = 'fixture-shell';
const ui = normalizePreferences();
ui.sidebar.inNewPlanes = false;
const initial: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'mixed',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'mixed',
      name: 'Mixed workspace acceptance',
      activePane: 'folder-0',
      roots: panes.slice(0, 4).map((pane) => pane.id),
      panes,
      arrangement: {},
      layout: {
        active: 'folder-0',
        placements: panes.map((pane, index) => ({
          id: pane.id,
          parent: index >= 4 ? 'folder-0' : undefined,
          location: {
            translateX: (index % 5) * 560,
            translateY: Math.floor(index / 5) * 400,
            translateZ: 0,
            rotateX: 0,
            rotateY: 0,
          },
          width: 520,
          height: 360,
          show: true,
        })),
      },
      tiling: { panes: panes.map((pane) => pane.id), layout: 'tiled', main: 0.6 },
    },
  ],
};
const stateFile = path.join(profile, 'viewer-state-v1.json');
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
});
await writeFile(stateFile, JSON.stringify(initial), { flag: 'wx' });
const saved = async () => JSON.parse(await readFile(stateFile, 'utf8')) as SavedState;
const app = await ownedApp(binary, profile, { environment: { SHELL: '/bin/sh' } });
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
const observations: unknown[] = [];
let passed = false;
try {
  connection = await app.connect();
  const { evaluate, command, onEvent } = connection;
  const heapSnapshot = async (label: string) => {
    if (!captureHeaps) return;
    const file = path.join(root, label + '.heapsnapshot');
    const descriptor = openSync(file, 'wx', 0o600);
    const off = onEvent((method, params) => {
      if (method === 'HeapProfiler.addHeapSnapshotChunk' && typeof params.chunk === 'string')
        writeSync(descriptor, params.chunk);
    });
    try {
      await command('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
      const record = { phase: 'heap-snapshot', label, file };
      observations.push(record);
      console.log(JSON.stringify(record));
    } finally {
      off();
      closeSync(descriptor);
    }
  };
  await command('Performance.enable');
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 940,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const palette = async (label: string) => {
    await evaluate('document.querySelector(\'[aria-label="Commands (⌘K)"]\').click()');
    await until(
      () => evaluate<string>('document.activeElement?.getAttribute("aria-label")'),
      (value) => value === 'Search commands',
      'Palette focus',
    );
    await command('Input.insertText', { text: label });
    await until(
      () =>
        evaluate<string>(
          'document.querySelector(".command-result[aria-selected=true]")?.textContent',
        ),
      (value) => value?.includes(label),
      label,
    );
    await evaluate('document.querySelector(".command-result[aria-selected=true]").click()');
  };
  await until(
    () => evaluate<number>('document.querySelectorAll(".plane-controls").length'),
    (count) => count === 20,
    'Twenty plane headers',
  );
  await until(
    () => evaluate<number>('document.querySelectorAll(".model-info").length'),
    (count) => count === 3,
    'Three model previews',
    30000,
  );
  await until(
    () => evaluate<number>('document.querySelectorAll(".xterm").length'),
    (count) => count === 2,
    'Two terminal views',
  );
  await until(
    () => evaluate<number>('document.querySelectorAll(".browser-plane").length'),
    (count) => count === 2,
    'Two browser views',
  );
  const processMemory = async () => {
    const output = await promisify(execFile)('/bin/ps', ['-axo', 'pid=,ppid=,rss=,comm=']);
    const rows = output.stdout
      .trim()
      .split('\n')
      .map((line) => {
        const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line);
        if (!match) throw new Error('Malformed process metadata');
        return {
          pid: Number(match[1]),
          parent: Number(match[2]),
          rssKB: Number(match[3]),
          name: path.basename(match[4]!),
        };
      });
    const owned = new Set([app.child.pid!]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const { pid, parent } of rows)
        if (owned.has(parent!) && !owned.has(pid!)) {
          owned.add(pid!);
          changed = true;
        }
    }
    const processes = rows.filter((item) => owned.has(item.pid));
    return { processes, residentKB: processes.reduce((total, item) => total + item.rssKB!, 0) };
  };
  const measure = async (phase: string) => {
    await command('HeapProfiler.collectGarbage');
    const heap = await command('Runtime.getHeapUsage');
    const dom = await command('Memory.getDOMCounters');
    const metrics = await command('Performance.getMetrics');
    const responsiveness = await evaluate(`new Promise(resolve => {
      const frames = [];
      let last = performance.now();
      const step = now => {
        frames.push(now - last);
        last = now;
        if (frames.length < 90) requestAnimationFrame(step);
        else { frames.sort((a,b) => a-b); resolve({median:frames[45],p95:frames[85],maximum:frames.at(-1)}); }
      };
      requestAnimationFrame(step);
    })`);
    const resources = await command<{ targetInfos: { type: string }[] }>('Target.getTargets');
    const record = {
      phase,
      heap,
      dom,
      metrics,
      responsiveness,
      targets: resources.targetInfos.reduce<Record<string, number>>(
        (counts, target) => ({ ...counts, [target.type]: (counts[target.type] ?? 0) + 1 }),
        {},
      ),
      memory: await processMemory(),
    };
    observations.push(record);
    console.log(JSON.stringify(record));
  };
  const browserReadiness = async (phase: string) => {
    const state = await evaluate<object>(
      'Promise.all(["browser-0", "browser-1"].map(id => window.viewer.browser({kind:"state",id})))',
    );
    const inspectFrames = () =>
      evaluate<{ frames?: string; pixel: number[]; loading: boolean; culled: string }[]>(`
      [...document.querySelectorAll('.browser-surface canvas')].map(canvas => ({
        frames: canvas.dataset.frames,
        pixel: [...canvas.getContext('2d').getImageData(10, 10, 1, 1).data],
        loading: !!canvas.closest('.browser-plane').querySelector('[aria-label="Stop loading"]'),
        culled: canvas.closest('[data-plurid-plane]').dataset.pluridCulled,
      }))
    `);
    const frames = await until(
      inspectFrames,
      (frames) =>
        frames.length === 2 &&
        frames.every(
          (frame) =>
            Number(frame.frames) > 0 &&
            !frame.loading &&
            frame.pixel.slice(0, 3).some((value) => value > 20),
        ),
      'Visible browsers finish loading and retain painted pixels',
      10000,
    ).catch(async (error: unknown) => {
      console.error(
        'Browser readiness diagnostics:',
        await evaluate(`Promise.all(["browser-0", "browser-1"].map(async id => ({
          state: await window.viewer.browser({kind: "state", id}),
          plane: document.querySelector('[data-viewer-plane="' + id + '"]')?.closest('[data-plurid-plane]')?.outerHTML.slice(0, 600),
        })))`),
      );
      throw error;
    });
    const record = { phase, state, frames, pageRequests };
    observations.push(record);
    console.log(JSON.stringify(record));
  };
  await browserReadiness('browser-initial');
  await measure('twenty-warm');
  await evaluate(`(() => {
    const frames = [], tasks = [];
    let last = performance.now(), tick = 0;
    const sample = now => { if (frames.length < 512) frames.push(now - last); last = now; tick = requestAnimationFrame(sample); };
    tick = requestAnimationFrame(sample);
    const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(entry => entry.duration)));
    observer.observe({type:'longtask'});
    window.__viewerMixedProbe = {stop() { cancelAnimationFrame(tick); observer.disconnect(); frames.sort((a,b)=>a-b); return { samples: frames.length, median: frames[Math.floor(frames.length/2)], p95: frames[Math.floor(frames.length*.95)], maximum: frames.at(-1), longTasks: tasks }; }};
  })()`);
  for (let step = 0; step < 12; step += 1) {
    await command('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: 4,
      y: 450,
      deltaX: step % 2 ? 70 : -70,
      deltaY: step % 2 ? 40 : -40,
    });
    await evaluate('new Promise(resolve => requestAnimationFrame(resolve))');
  }
  for (const pane of panes.slice(4, 10)) {
    const selector = `.plane-controls[data-viewer-plane="${pane.id}"] [aria-label="Frame plane"]`;
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    await until(
      () =>
        evaluate<boolean>(
          `(() => { const bounds = document.querySelector('.plane-controls[data-viewer-plane="${pane.id}"]').closest('[data-plurid-plane]').getBoundingClientRect(); return bounds.width >= 375 && !document.querySelector('[data-plurid-motion]'); })()`,
        ),
      Boolean,
      'Frame navigation ' + pane.id,
    );
  }
  observations.push({
    phase: 'during-navigation',
    ...(await evaluate<object>('window.__viewerMixedProbe.stop()')),
  });
  await palette('Tiling: Grid');
  await browserReadiness('browser-after-cycles');
  await measure('twenty-after-navigation');
  await heapSnapshot('warm');
  const closing = panes
    .slice(10)
    .map((pane) => pane.id)
    .reverse();
  for (let cycle = 0; cycle < cycleCount; cycle += 1) {
    for (const id of closing) {
      const selector = `.plane-controls[data-viewer-plane="${id}"] [aria-label="Close plane"]`;
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
      await until(
        saved,
        (state) => !state.workspaces[0]!.panes.some((pane) => pane.id === id),
        'Closed ' + id,
      );
    }
    await until(
      () => evaluate<number>('document.querySelectorAll(".plane-controls").length'),
      (count) => count === 10,
      'Ten remaining planes',
    );
    await measure('ten-after-close-' + cycle);
    for (let index = 0; index < closing.length; index += 1) await palette('Undo arrangement');
    await until(
      () => evaluate<number>('document.querySelectorAll(".plane-controls").length'),
      (count) => count === 20,
      'Twenty reopened views',
    );
    await until(
      () => evaluate<number>('document.querySelectorAll(".model-info").length'),
      (count) => count === 3,
      'Reopened models',
    );
    await measure('twenty-after-reopen-' + cycle);
    await browserReadiness('browser-after-reopen-' + cycle);
    if (cycle === 4 || cycle === 19 || cycle === cycleCount - 1)
      await heapSnapshot('reopened-' + (cycle + 1));
  }
  const cycles = observations.filter(
    (value): value is { phase: string; heap: { usedSize: number }; dom: { nodes: number } } =>
      !!value &&
      typeof value === 'object' &&
      'phase' in value &&
      String(value.phase).startsWith('twenty-after-reopen-'),
  );
  assert.equal(cycles.length, cycleCount);
  if (captureHeaps) {
    const summary = await modelHeapSummary(path.join(root, `reopened-${cycleCount}.heapsnapshot`));
    observations.push({ phase: 'final-heap-summary', ...summary });
    console.log(JSON.stringify(observations.at(-1)));
    assert.equal(summary.detachedModelStages, 0, 'Closed model stages are collectable');
    assert.equal(summary.detachedModelCanvases, 0, 'Disposed WebGL canvases are collectable');
  }
  assert.ok(
    cycles.at(-1)!.heap.usedSize - cycles[0]!.heap.usedSize < 32 * 1024 * 1024,
    'Reopened views have bounded retained heap',
  );
  assert.ok(
    cycles.at(-1)!.dom.nodes - cycles[0]!.dom.nodes < 1000,
    'Closed views do not accumulate detached trees',
  );
  await palette('Tiling: Grid');
  await evaluate(
    `document.querySelector('.plane-controls[data-viewer-plane="folder-0"] .plane-related').click()`,
  );
  await until(
    () => evaluate<string>('document.activeElement?.getAttribute("aria-label")'),
    (label) => label === 'Search Related planes',
    'Related-plane keyboard search',
  );
  await command('Input.insertText', { text: 'Terminal' });
  await until(
    () =>
      evaluate<string>(
        'document.querySelector(".choice-menu .command-result[aria-selected=true]")?.textContent',
      ),
    (value) => value?.includes('Terminal ·'),
    'Tool identity in related planes',
  );
  await evaluate(
    'document.querySelector(".choice-menu .command-result[aria-selected=true]").click()',
  );
  const selected = await until(
    saved,
    (state) => state.workspaces[0]!.activePane?.startsWith('terminal-'),
    'Navigate to related terminal',
  );
  const terminal = selected.workspaces[0]!.activePane!;
  await evaluate(
    `document.querySelector('.plane-controls[data-viewer-plane="${terminal}"] [aria-label="Back to parent plane"]').click()`,
  );
  await until(saved, (state) => state.workspaces[0]!.activePane === 'folder-0', 'Return to parent');
  await palette('Tiling: Grid');
  if (process.env.VIEWER_MIXED_CAPTURE === '1') {
    for (const look of ['Dark', 'Light']) {
      await palette('Appearance: ' + look);
      for (const width of [1440, 900]) {
        await command('Emulation.setDeviceMetricsOverride', {
          width,
          height: 940,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await evaluate('new Promise(resolve => setTimeout(resolve, 1000))');
        await browserReadiness(`browser-${look}-${width}`);
        const geometry = await evaluate<object[]>(
          `[...document.querySelectorAll('.plane-controls')].map(header => ({id:header.dataset.viewerPlane,overflow:header.scrollWidth-header.clientWidth,frame:!!header.querySelector('[aria-label="Frame plane"]')?.getClientRects().length,dock:!![...header.querySelectorAll('button')].find(button => /^(Dock|Undock) plane$/.test(button.getAttribute('aria-label') ?? ''))?.getClientRects().length}))`,
        );
        observations.push({ phase: 'header-geometry', look, width, geometry });
        for (const header of geometry as {
          id: string;
          overflow: number;
          frame: boolean;
          dock: boolean;
        }[]) {
          assert.ok(header.overflow <= 1, 'Header controls fit: ' + header.id);
          assert.ok(header.frame && header.dock, 'Frame and Dock remain reachable: ' + header.id);
        }
        const picture = await command<{ data: string }>('Page.captureScreenshot', {
          format: 'png',
        });
        await writeFile(
          path.join(root, 'mixed-' + look.toLowerCase() + '-' + width + '.png'),
          Buffer.from(picture.data, 'base64'),
          { flag: 'wx' },
        );
      }
    }
  }
  passed = true;
} finally {
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      {
        passed,
        binary,
        root,
        observations,
        limits:
          'Hidden-window renderer frame scheduling and aggregate process RSS; not physical compositor FPS or private GPU allocations.',
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  try {
    await app.close(connection);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  console.log('Mixed-workspace evidence retained:', root);
}
