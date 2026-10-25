/** Retained native HTML/server checks. No clipboard, file saves, consent or removal automation. */
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { CURRENT_STATE_VERSION, type Pane, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import type { LocalServer } from '../../src/domain/previews/web';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';

assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const binary = path.resolve(
  process.env.VIEWER_TEST_BINARY ??
    path.join(appRoot, `out/Viewer-darwin-${process.arch}/Viewer.app/Contents/MacOS/Viewer`),
);
const suppliedHTML = process.env.VIEWER_TEST_HTML_FILE;
const root = await realpath(await temporaryRoot('viewer-native-web-'));
const files = path.join(root, 'Generated site');
await mkdir(files, { mode: 0o700 });
await writeFile(
  path.join(files, 'index.html'),
  `<!doctype html>
<html><head><title>Generated local site</title>
<link rel="stylesheet" href="style.css">
<style>body { background: rgb(1, 2, 3); }</style>
</head><body><h1>Generated site</h1><img id="asset-image" src="asset.svg">
<script src="script.js"></script>
<script>
  const root = document.documentElement;
  root.dataset.inlineScript = 'executed';
  root.dataset.viewerBridge = typeof window.viewer;
  root.dataset.nodeRequire = typeof window.require;
  root.dataset.nodeProcess = typeof window.process;
  root.dataset.opaqueOrigin = self.origin;
  try {
    void parent.document.title;
    root.dataset.parentAccess = 'read';
  } catch {
    root.dataset.parentAccess = 'blocked';
  }
  document.addEventListener('run-owned-probes', async () => {
    const targets = JSON.parse(root.dataset.probeTargets);
    const results = {};
    await Promise.all(Object.entries(targets).map(async ([name, url]) => {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
        results[name] = 'resolved:' + response.status;
      } catch {
        results[name] = 'blocked';
      }
    }));
    root.dataset.probeResults = JSON.stringify(results);
    root.dataset.probesDone = 'true';
  });
</script></body></html>`,
  { flag: 'wx', mode: 0o600 },
);
await writeFile(path.join(files, 'style.css'), 'h1 { color: rgb(4, 5, 6); }', {
  flag: 'wx',
  mode: 0o600,
});
await writeFile(
  path.join(files, 'script.js'),
  'document.documentElement.dataset.assetScript = "executed";',
  { flag: 'wx', mode: 0o600 },
);
await writeFile(path.join(files, 'message.json'), '{"generated":"owned-asset"}', {
  flag: 'wx',
  mode: 0o600,
});
await writeFile(
  path.join(files, 'asset.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>',
  { flag: 'wx', mode: 0o600 },
);
await writeFile(
  path.join(files, 'other.html'),
  '<!doctype html><title>Other owned capability</title>',
  { flag: 'wx', mode: 0o600 },
);
const original = path.resolve(suppliedHTML ?? path.join(files, 'index.html'));
const chairSample = (await readFile(original, 'utf8')).includes(
  '<title>FORME — Chairs, considered.</title>',
);
const hash = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const candidate = {
  binary,
  executableSha256: await hash(binary),
  archiveSha256: await hash(path.join(path.dirname(path.dirname(binary)), 'Resources/app.asar')),
  platform: process.platform,
  architecture: process.arch,
  macOS: execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(),
  started: new Date().toISOString(),
};
const originalSha256 = await hash(original);
const checks: { id: string; detail: unknown }[] = [];
const evidence: string[] = [];
const resultFile = path.join(root, 'result.json');
async function save(error?: unknown) {
  await writeFile(
    resultFile,
    JSON.stringify(
      {
        candidate,
        root,
        original,
        originalSource: suppliedHTML ? 'provided' : 'generated',
        originalSha256,
        checks,
        evidence,
        error: error instanceof Error ? error.stack : error,
        retained: true,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}

async function profile(name: string, panes: Pane[]) {
  const directory = path.join(root, name);
  await mkdir(directory, { mode: 0o700 });
  const settings = defaultSettings(files);
  settings.providers = [];
  settings.hotkey.enabled = false;
  settings.browsing.newPlaneLocation = 'custom';
  settings.browsing.newPlanePath = files;
  settings.browsing.emptyWorkspaceLocation = 'custom';
  settings.browsing.emptyWorkspacePath = files;
  await writeFile(
    path.join(directory, 'config.jsonc'),
    JSON.stringify({ version: 1, settings, ui: normalizePreferences() }),
    { flag: 'wx', mode: 0o600 },
  );
  const state: SavedState = {
    version: CURRENT_STATE_VERSION,
    activeWorkspace: name,
    look: 'dark',
    favorites: [],
    recents: [],
    workspaces: [
      {
        id: name,
        name,
        panes,
        roots: panes.map((pane) => pane.id),
        activePane: panes[0]?.id,
        arrangement: {},
      },
    ],
  };
  await writeFile(path.join(directory, 'viewer-state-v1.json'), JSON.stringify(state), {
    flag: 'wx',
    mode: 0o600,
  });
  return directory;
}

type Application = Awaited<ReturnType<typeof ownedApp>>;
type Connection = Awaited<ReturnType<Application['connect']>>;
interface FrameTree {
  frame: { id: string; url: string };
  childFrames?: FrameTree[];
}
const frameIn = (tree: FrameTree, url: string): FrameTree | undefined =>
  tree.frame.url === url
    ? tree
    : tree.childFrames?.map((child) => frameIn(child, url)).find(Boolean);

async function world(main: Connection, url: string) {
  let sessionId: string | undefined;
  const ready = await until(
    async () => {
      const tree = await main.command<{ frameTree: FrameTree }>('Page.getFrameTree');
      const targets = await main.command<{
        targetInfos: { targetId: string; type: string; url: string }[];
      }>('Target.getTargets');
      return {
        tree,
        frame: frameIn(tree.frameTree, url),
        target: targets.targetInfos.find((item) => item.type === 'iframe' && item.url === url),
        targets: targets.targetInfos,
      };
    },
    (value) => !!value.frame || !!value.target,
    'private HTML frame navigation',
  );
  let tree = ready.tree;
  let frame = ready.frame;
  if (!frame) {
    const target = ready.target;
    assert.ok(target, 'The private HTML frame has an owned debugger target.');
    const attached = await main.command<{ sessionId: string }>('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    });
    sessionId = attached.sessionId;
    tree = await main.command('Page.getFrameTree', {}, sessionId);
    frame = frameIn(tree.frameTree, url);
  }
  assert.ok(frame, 'Private frame exists in the native frame tree.');
  const context = await main.command<{ executionContextId: number }>(
    'Page.createIsolatedWorld',
    {
      frameId: frame.frame.id,
      worldName: 'viewer-native-web-inspection',
      grantUniveralAccess: false,
    },
    sessionId,
  );
  return <T = unknown>(expression: string) =>
    main.evaluate<T>(expression, {
      contextId: context.executionContextId,
      sessionId,
      userGesture: false,
    });
}

async function html() {
  const directory = await profile('HTML profile', [
    { id: 'chair-preview', type: 'preview', path: original },
  ]);
  const app = await ownedApp(binary, directory, { mode: 'hidden' });
  evidence.push(app.evidenceDirectory);
  let main: Connection | undefined;
  try {
    main = await app.connect();
    const url = await until(
      () =>
        main!.evaluate<string>(
          'document.querySelector(".html-preview-frame")?.getAttribute("src") ?? ""',
        ),
      (value) => value.startsWith('viewer-html:'),
      'actual HTML plane iframe',
    );
    const inspect = await world(main, url);
    const page = await until(
      () =>
        inspect<{ title: string; color: string; heading: string; ready: string }>(
          '({title:document.title,color:getComputedStyle(document.body).backgroundColor,heading:document.querySelector("h1")?.textContent,ready:document.readyState})',
        ),
      (value) =>
        value.ready === 'complete' &&
        (!chairSample || (value.title.includes('FORME') && value.color === 'rgb(244, 241, 234)')),
      'user HTML document and inline CSS',
    );
    if (chairSample) {
      await inspect('window.scrollTo({top:160,behavior:"instant"})');
      await until(
        () => inspect<boolean>('document.getElementById("header").classList.contains("scrolled")'),
        Boolean,
        'original inline scroll script',
      );
    }
    const attributes = await main.evaluate<{ sandbox: string; srcdoc: string | null }>(
      '({sandbox:document.querySelector("iframe").getAttribute("sandbox"),srcdoc:document.querySelector("iframe").getAttribute("srcdoc")})',
    );
    assert.equal(attributes.sandbox, 'allow-scripts');
    assert.equal(attributes.srcdoc, null);
    const image = await main.command<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    const screenshot = path.join(app.evidenceDirectory, 'html-preview.png');
    await writeFile(screenshot, Buffer.from(image.data, 'base64'), { flag: 'wx', mode: 0o600 });
    await main.evaluate('document.querySelector("[role=tab][id$=source-tab]").click()');
    await until(
      () =>
        main!.evaluate<boolean>(
          'document.querySelector("[role=tab][id$=source-tab]")?.getAttribute("aria-selected")==="true" && !!document.querySelector(".code-scroll")',
        ),
      Boolean,
      'source toggle without editing',
    );
    await main.evaluate('document.querySelector("[role=tab][id$=preview-tab]").click()');
    await until(
      () => main!.evaluate<boolean>('!!document.querySelector(".html-preview-frame")'),
      Boolean,
      'preview toggle',
    );
    checks.push({ id: 'actual-html-render', detail: { page, attributes, screenshot } });
    await noticeFooter(main, app, directory);
    await save();
    console.log(
      'PASS actual-html-render: real preview plane and Source toggle; input file hash unchanged.',
    );
  } finally {
    await app.close(main);
    assert.equal(await hash(original), originalSha256, 'The user HTML bytes remain unchanged.');
  }
}

async function noticeFooter(main: Connection, app: Application, directory: string) {
  // Electron's page debugger omits the Browser window-control domain. This is the actual CSS
  // viewport used by layout and hit testing; assert its exact dimensions below.
  await main.command('Emulation.setDeviceMetricsOverride', {
    width: 780,
    height: 560,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await main.evaluate(
    `document.querySelector('[data-viewer-plane="chair-preview"] [aria-label="Dock plane"]').click()`,
  );
  const missing = path.join(root, 'Missing generated page.html');
  const invocation = await promisify(execFile)(binary, [missing], {
    cwd: files,
    env: {
      ...process.env,
      VIEWER_DATA_DIRECTORY: directory,
      VIEWER_RENDER_TEST: '1',
      VIEWER_BACKGROUND_TEST: '1',
      VIEWER_TEST_NO_REMOVAL: '1',
      VIEWER_TEST_PRESERVE: '1',
    },
    timeout: 15_000,
  });
  await writeFile(
    path.join(app.evidenceDirectory, 'missing-path-cli.json'),
    JSON.stringify(invocation, null, 2),
    { flag: 'wx', mode: 0o600 },
  );
  await until(
    () => main.evaluate<string>('document.querySelector(".notice")?.textContent ?? ""'),
    (value) => value.includes('Missing generated page.html'),
    'actual CLI error notice',
  );
  const layout = await until(
    () =>
      main.evaluate<{
        width: number;
        height: number;
        surfaceBottom: number;
        noticeTop: number;
        noticeBottom: number;
        footerBottom: number;
        buttonVisible: boolean;
        hit: boolean;
        noticePosition: string;
      }>(`(() => {
    const surface = document.querySelector('.workspace-surface').getBoundingClientRect();
    const notice = document.querySelector('.notice');
    const status = notice.getBoundingClientRect();
    const button = document.querySelector('.preview-info [aria-label="Open file in default app"]');
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return {
      width: innerWidth, height: innerHeight, surfaceBottom: surface.bottom,
      noticeTop: status.top, noticeBottom: status.bottom, footerBottom: rect.bottom,
      buttonVisible: rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth && rect.top >= surface.top && rect.bottom <= surface.bottom + 1,
      hit: button.contains(hit), noticePosition: getComputedStyle(notice).position,
    };
  })()`),
    (value) =>
      value.width === 780 &&
      value.height === 560 &&
      value.buttonVisible &&
      value.hit &&
      value.noticeTop >= value.surfaceBottom - 1 &&
      value.noticeBottom <= value.height,
    'notice flow and preview-footer hit testing',
  );
  assert.notEqual(layout.noticePosition, 'fixed');
  const screenshot = await main.command<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
  });
  const image = path.join(app.evidenceDirectory, 'notice-footer-780x560.png');
  await writeFile(image, Buffer.from(screenshot.data, 'base64'), { flag: 'wx', mode: 0o600 });
  checks.push({ id: 'notice-footer-layout', detail: { layout, screenshot: image } });
}

async function command(main: Connection, label: string) {
  await main.evaluate(`document.querySelector('[aria-label="Commands (⌘K)"]').click()`);
  await until(
    () =>
      main.evaluate<boolean>(
        'document.activeElement?.getAttribute("aria-label") === "Search commands"',
      ),
    Boolean,
    'command palette input',
  );
  await main.command('Input.insertText', { text: label });
  await until(
    () =>
      main.evaluate<string>(
        'document.querySelector(".command-result[aria-selected=true]")?.textContent ?? ""',
      ),
    (text) => text.includes(label),
    label,
  );
  await main.evaluate('document.querySelector(".command-result[aria-selected=true]").click()');
}

async function isolation() {
  const hits: string[] = [];
  const trap = createServer((request, response) => {
    hits.push((request.url ?? '').split('?')[0]!);
    response.end('Owned offline-network trap.');
  });
  await new Promise<void>((resolve, reject) => {
    trap.once('error', reject);
    trap.listen(0, '127.0.0.1', () => resolve());
  });
  const address = trap.address();
  assert.ok(address && typeof address === 'object');
  const directory = await profile('HTML isolation profile', [
    { id: 'isolated-preview', type: 'preview', path: path.join(files, 'index.html') },
  ]);
  const app = await ownedApp(binary, directory, { mode: 'hidden' });
  evidence.push(app.evidenceDirectory);
  let main: Connection | undefined;
  let other: { id: string; url: string } | undefined;
  let resource: { id: string; url: string } | undefined;
  try {
    main = await app.connect();
    const url = await until(
      () =>
        main!.evaluate<string>(
          'document.querySelector(".html-preview-frame")?.getAttribute("src") ?? ""',
        ),
      (value) => value.startsWith('viewer-html:'),
      'generated HTML frame',
    );
    const inspect = await world(main, url);
    const state = await until(
      () =>
        inspect<Record<string, string>>(
          '({...document.documentElement.dataset, background:getComputedStyle(document.body).backgroundColor, color:getComputedStyle(document.querySelector("h1")).color, image:String(document.getElementById("asset-image").naturalWidth)})',
        ),
      (value) =>
        value.inlineScript === 'executed' &&
        value.assetScript === 'executed' &&
        value.image === '16',
      'inline and same-capability CSS/JS/image',
    );
    assert.equal(state.viewerBridge, 'undefined');
    assert.equal(state.nodeRequire, 'undefined');
    assert.equal(state.nodeProcess, 'undefined');
    assert.equal(state.opaqueOrigin, 'null');
    assert.equal(state.parentAccess, 'blocked');
    assert.equal(state.background, 'rgb(1, 2, 3)');
    assert.equal(state.color, 'rgb(4, 5, 6)');
    resource = await main.evaluate(
      `window.viewer.resource(${JSON.stringify(path.join(files, 'other.html'))})`,
    );
    other = await main.evaluate(`window.viewer.htmlPreview(${JSON.stringify(resource!.id)})`);
    const targets = {
      same: new URL('message.json', url).href,
      remote: `http://127.0.0.1:${address.port}/blocked`,
      app: 'viewer-app://app/index.html',
      resource: resource!.url,
      other: other!.url,
    };
    await inspect(
      `document.documentElement.dataset.probeTargets = ${JSON.stringify(JSON.stringify(targets))}; document.dispatchEvent(new Event('run-owned-probes'));`,
    );
    const results = await until(
      () =>
        inspect<Record<string, string> | null>(
          'document.documentElement.dataset.probesDone === "true" ? JSON.parse(document.documentElement.dataset.probeResults) : null',
        ),
      Boolean,
      'opaque page fetch isolation',
    );
    assert.equal(results!.same, 'resolved:200');
    for (const name of ['remote', 'app', 'resource', 'other'])
      assert.equal(results![name], 'blocked', name);
    assert.deepEqual(hits, [], 'No offline preview request reached the owned network trap.');
    checks.push({ id: 'html-isolation', detail: { state, results, trapHits: hits } });
    await save();
    console.log(
      'PASS html-isolation: opaque parent/bridge isolation, same-cap assets and blocked remote/app/resource/other-cap fetches.',
    );
  } finally {
    if (main && other)
      await main.evaluate(`window.viewer.htmlPreviewClose(${JSON.stringify(other.id)})`);
    if (main && resource)
      await main.evaluate(`window.viewer.release(${JSON.stringify(resource.id)})`);
    await app.close(main);
    await new Promise<void>((resolve, reject) =>
      trap.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function server() {
  let liveURL: string | undefined;
  const directory = await profile('Server profile', [
    {
      id: 'server-folder',
      type: 'folder',
      path: files,
      mode: 'list',
      sort: 'name',
      descending: false,
      showHidden: false,
      history: [files],
      historyIndex: 0,
    },
  ]);
  const app = await ownedApp(binary, directory, { mode: 'hidden' });
  evidence.push(app.evidenceDirectory);
  let main: Connection | undefined;
  try {
    main = await app.connect();
    await until(
      () => main!.evaluate<number>('document.querySelectorAll("[data-file-path]").length'),
      (count) => count > 0,
      'generated server folder',
    );
    await command(main, 'Start local server');
    const running = await until(
      () => main!.evaluate<LocalServer[]>('window.viewer.localServers()'),
      (rows) => rows.some((row) => row.state === 'running'),
      'actual local server command',
    );
    const current = running.find((row) => row.state === 'running')!;
    const viewID = await until(
      () =>
        main!.evaluate<string>(
          'document.querySelector(".server-plane")?.closest("[data-viewer-pane]")?.dataset.viewerPane || ""',
        ),
      Boolean,
      'server view ID',
    );
    const response = await fetch(current.url);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Generated site/);
    assert.match(await (await fetch(new URL('style.css', current.url))).text(), /rgb\(4, 5, 6\)/);
    const linked = await until(
      () =>
        main!.evaluate<boolean>(`(() => {
      const element = document.querySelector('[data-viewer-plane="server-folder"]');
      const key = Object.keys(element).find(key => key.startsWith('__reactFiber'));
      for (let fiber = element[key]; fiber; fiber = fiber.return) {
        for (let hook = fiber.memoizedState; hook; hook = hook.next) {
          const api = hook.memoizedState?.current;
          if (!api?.camera?.frame || !api?.tree?.get) continue;
          const host = node => node.routeDivisions.plane.parameters.id || node.routeDivisions.path.parameters.id;
          return api.tree.get().some(node => host(node) === 'server-folder' && node.children?.some(child => host(child) === ${JSON.stringify(viewID)}));
        }
      }
      return false;
    })()`),
      Boolean,
      'server child belongs to captured folder',
    );
    const saved = await until(
      async () =>
        JSON.parse(
          await readFile(path.join(directory, 'viewer-state-v1.json'), 'utf8'),
        ) as SavedState,
      (state) =>
        state.workspaces.some((space) =>
          space.panes.some(
            (pane) =>
              pane.id === viewID && pane.type === 'server' && pane.runtimeID === current.paneID,
          ),
        ),
      'server plane persisted',
    );
    assert.ok(!saved.workspaces[0]!.roots.includes(viewID));
    checks.push({ id: 'actual-server-start', detail: { current, linked } });
    await save();
    console.log(
      'PASS actual-server-start: real Start local server command, linked child, loopback HTML/CSS and saved server plane.',
    );
    assert.equal(
      (await fetch(new URL('missing?synthetic-query=not-logged', current.url))).status,
      404,
    );
    assert.equal((await fetch(new URL('script.js', current.url), { method: 'HEAD' })).status, 200);
    await main.evaluate(`document.querySelector('[aria-label="Refresh request log"]').click()`);
    const rows = await until(
      () =>
        main!.evaluate<string[][]>(
          `Array.from(document.querySelectorAll('.server-log tbody tr')).map(row => Array.from(row.cells).map(cell => cell.textContent))`,
        ),
      (value) => value.length >= 4,
      'request log rows',
    );
    assert.ok(rows.some((row) => row[1] === 'HEAD' && row[3] === '200'));
    assert.ok(rows.some((row) => row[2] === '/missing' && row[3] === '404'));
    assert.ok(!JSON.stringify(rows).includes('synthetic-query'));
    const setQuery = (value: string) =>
      main!.evaluate(`(() => {
      const input = document.querySelector('[aria-label="Filter server requests"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await setQuery('/missing');
    await until(
      () => main!.evaluate<number>('document.querySelectorAll(".server-log tbody tr").length'),
      (value) => value === 1,
      'path filter',
    );
    await setQuery('');
    await main.evaluate(`document.querySelector('[aria-label="Request status"]').click()`);
    await until(
      () =>
        main!.evaluate<boolean>(
          `!!Array.from(document.querySelectorAll('[role="dialog"][aria-label="Request status"] button')).find(button => button.textContent.includes('4xx'))`,
        ),
      Boolean,
      'request status choices',
    );
    await main.evaluate(
      `Array.from(document.querySelectorAll('[role="dialog"][aria-label="Request status"] button')).find(button => button.textContent.includes('4xx')).click()`,
    );
    await until(
      () =>
        main!.evaluate<string[]>(
          'Array.from(document.querySelectorAll(".server-log tbody tr")).map(row => row.cells[3].textContent)',
        ),
      (value) => value.length === 1 && value[0] === '404',
      '4xx status filter',
    );
    const screenshot = await main.command<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      path.join(app.evidenceDirectory, 'server-log.png'),
      Buffer.from(screenshot.data, 'base64'),
      { flag: 'wx', mode: 0o600 },
    );
    await main.evaluate(`document.querySelector('[aria-label="Clear request log"]').click()`);
    await until(
      () => main!.evaluate<string>('document.querySelector(".server-log-footer").textContent'),
      (value) => value.includes('0 of 0'),
      'cleared request log',
    );
    await main.evaluate(
      `Array.from(document.querySelectorAll('.server-summary button')).find(button => button.textContent.trim() === 'Stop').click()`,
    );
    await until(
      () => main!.evaluate<string>('document.querySelector(".server-state").dataset.state'),
      (value) => value === 'stopped',
      'Stop button',
    );
    await stopped(current.url);
    await main.evaluate(`document.querySelector('[aria-label="Restart server"]').click()`);
    const restarted = await until(
      () => main!.evaluate<LocalServer[]>('window.viewer.localServers()'),
      (value) => value.some((row) => row.state === 'running'),
      'restart server',
    );
    const live = restarted.find((row) => row.state === 'running')!;
    liveURL = live.url;
    assert.equal((await fetch(live.url)).status, 200);
    checks.push({
      id: 'server-log-and-controls',
      detail: {
        rows,
        screenshot: path.join(app.evidenceDirectory, 'server-log.png'),
        restarted: live,
      },
    });
    await save();

    await main.evaluate(
      `document.querySelector('[data-viewer-plane="${viewID}"] [aria-label="Close plane"]').click()`,
    );
    await until(
      () => main!.evaluate<LocalServer[]>('window.viewer.localServers()'),
      (value) => value.some((row) => row.id === live.id && row.state === 'running'),
      'closing server view keeps its listener',
    );
    assert.equal((await fetch(live.url)).status, 200);
    await command(main, 'Local servers');
    await until(
      () => main!.evaluate<boolean>('!!document.querySelector(".server-list-row")'),
      Boolean,
      'local server manager',
    );
    await main.evaluate(
      'Array.from(document.querySelectorAll(".server-list-row button")).find(button=>button.textContent.trim()==="Show plane").click()',
    );
    await until(
      () => main!.evaluate<boolean>('!!document.querySelector(".server-plane")'),
      Boolean,
      'reattached server view',
    );
    assert.equal(
      (await main.evaluate<LocalServer[]>('window.viewer.localServers()')).find(
        (server) => server.state === 'running',
      )!.id,
      live.id,
    );
    assert.equal((await fetch(live.url)).status, 200);
    checks.push({
      id: 'server-lifecycle',
      detail: {
        filtered: true,
        cleared: true,
        stopped: true,
        restarted: true,
        planeCloseKeptRunning: true,
        reopenedSameRuntime: true,
      },
    });
    await save();
    console.log(
      'PASS server-lifecycle: log filters/clear, stop/restart, detached listener and reattached controls.',
    );
  } finally {
    await app.close(main);
    if (liveURL) await stopped(liveURL);
  }
}

async function stopped(url: string) {
  await until(
    async () => {
      try {
        await fetch(url, { signal: AbortSignal.timeout(500) });
        return false;
      } catch {
        return true;
      }
    },
    Boolean,
    'owned server listener stopped',
  );
}

try {
  await save();
  await html();
  await isolation();
  await server();
  assert.equal(await hash(binary), candidate.executableSha256);
  assert.equal(
    await hash(path.join(path.dirname(path.dirname(binary)), 'Resources/app.asar')),
    candidate.archiveSha256,
  );
  await save();
} catch (error) {
  await save(error);
  throw error;
} finally {
  console.log('Retained native web evidence: ' + resultFile);
}
