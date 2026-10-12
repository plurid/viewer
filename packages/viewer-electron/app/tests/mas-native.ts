/** Signed MAS startup, handle-pressure and permission-boundary checks. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import store from '../mac-app-store.json' with { type: 'json' };
import type { Bootstrap, FolderListing } from '../src/domain/contracts';
import type { IndexedResult, IndexStatus, SettingsSnapshot } from '../src/domain/services';

assert.equal(process.platform, 'darwin', 'The signed MAS check requires macOS.');
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = path.join(appRoot, 'out/mac-app-store/mas-dev', process.arch, 'Viewer.app');
const native = (command: string, args: string[]) =>
  execFileSync(command, args, { encoding: 'utf8', maxBuffer: 4_000_000 });
native('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
assert.equal(
  native('/usr/bin/plutil', [
    '-extract',
    'CFBundleIdentifier',
    'raw',
    '-o',
    '-',
    path.join(bundle, 'Contents/Info.plist'),
  ]).trim(),
  store.bundleID,
);
const entitlements = JSON.parse(
  execFileSync(
    'python3',
    [
      '-c',
      'import json, plistlib, sys; print(json.dumps(plistlib.loads(sys.stdin.buffer.read())))',
    ],
    {
      encoding: 'utf8',
      input: native('/usr/bin/codesign', ['--display', '--entitlements', '-', '--xml', bundle]),
    },
  ),
) as Record<string, unknown>;
assert.equal(entitlements['com.apple.security.app-sandbox'], true);
assert.equal(entitlements['com.apple.security.get-task-allow'], true);
assert.equal(entitlements['com.apple.developer.team-identifier'], store.teamID);
assert.deepEqual(entitlements['com.apple.security.application-groups'], [store.applicationGroup]);

// This run uses a unique directory inside this app's container, never the normal
// Viewer profile. The host fixture stays outside it and receives no native grant.
const profile = path.join(
  os.homedir(),
  'Library/Containers',
  store.bundleID,
  'Data/Library/Application Support/Viewer',
  'mas-verification-' + randomUUID(),
);
const fixture = await mkdtemp('/private/tmp/viewer-mas-native-');
const externalFile = path.join(fixture, 'Unselected.txt');
await writeFile(externalFile, 'Generated unselected MAS verification file.', { mode: 0o600 });
// Only generated files in this isolated app container are indexed. A large flat
// directory also exercises plane watches, separately from recursive indexing.
const stress = path.join(profile, 'watch-pressure');
await mkdir(stress, { recursive: true });
for (let directory = 0; directory < 16; directory++) {
  const nested = path.join(stress, 'nested-' + directory);
  await mkdir(nested);
  for (let file = 0; file < 80; file++)
    await writeFile(path.join(nested, `Generated-${file}.txt`), 'Generated watcher fixture.');
}
for (let file = 0; file < 1024; file++)
  await writeFile(path.join(stress, `Flat-${file}.txt`), 'Generated watcher fixture.');
const listener = net.createServer();
await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
const port = (listener.address() as net.AddressInfo).port;
await new Promise<void>((resolve) => listener.close(() => resolve()));
const child = spawn(
  'python3',
  [
    '-c',
    // Limit only this owned test process; never change the user's global limits.
    'import os,resource,sys; resource.setrlimit(resource.RLIMIT_NOFILE,(512,512)); os.execv(sys.argv[1],sys.argv[1:])',
    path.join(bundle, 'Contents/MacOS/Viewer'),
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
  ],
  {
    env: {
      ...process.env,
      VIEWER_DATA_DIRECTORY: profile,
      VIEWER_RENDER_TEST: '1',
      VIEWER_BACKGROUND_TEST: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let output = '';
child.stdout.on('data', (value) => (output += String(value)));
child.stderr.on('data', (value) => (output += String(value)));
let socket: WebSocket | undefined;
let next = 0;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
const exceptions: string[] = [];

async function until<T>(read: () => Promise<T>, accepts: (value: T) => boolean, label: string) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(
        `Signed Viewer exited (${child.exitCode ?? child.signalCode}): ${output.slice(-3000)}`,
      );
    try {
      const value = await read();
      if (accepts(value)) return value;
    } catch {
      // The debugger and renderer become available asynchronously during startup.
    }
    await delay(100);
  }
  throw new Error('Timed out waiting for ' + label);
}
function command<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const id = ++next;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Debugger timeout: ' + method));
    }, 15000);
    pending.set(id, {
      resolve(value) {
        clearTimeout(timer);
        resolve(value as T);
      },
      reject(error) {
        clearTimeout(timer);
        reject(error);
      },
    });
    socket!.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate<T>(expression: string): Promise<T> {
  const reply = await command<{ result: { value: T }; exceptionDetails?: unknown }>(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true, userGesture: true },
  );
  assert.equal(reply.exceptionDetails, undefined, 'Renderer evaluation failed');
  return reply.result.value;
}

try {
  const target = await until(
    async () => {
      const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
        url: string;
        webSocketDebuggerUrl: string;
      }[];
      return targets.find((item) => item.url.startsWith('viewer-app://app/'));
    },
    Boolean,
    'the signed MAS renderer',
  );
  socket = new WebSocket(target!.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket!.addEventListener('open', () => resolve(), { once: true });
    socket!.addEventListener('error', () => reject(new Error('Debugger connection failed')), {
      once: true,
    });
  });
  socket.addEventListener('message', (event) => {
    const reply = JSON.parse(String(event.data));
    if (reply.method === 'Runtime.exceptionThrown')
      exceptions.push(reply.params.exceptionDetails.text);
    const request = pending.get(reply.id);
    if (!request) return;
    pending.delete(reply.id);
    if (reply.error) request.reject(new Error(reply.error.message));
    else request.resolve(reply.result);
  });
  await command('Runtime.enable');
  await until(
    () =>
      evaluate<boolean>(
        '!!window.viewer && !!document.querySelector(\'[aria-label="Close plane"]\') && document.body.innerText.includes("Allow folder access")',
      ),
    Boolean,
    'the initial folder permission request',
  );
  const bootstrap = await evaluate<Bootstrap>('window.viewer.bootstrap()');
  assert.equal(bootstrap.home, os.homedir(), 'MAS must preserve the actual home location.');
  const settings = await evaluate<SettingsSnapshot>('window.viewer.settingsGet()');
  assert.equal(settings.config?.path, path.join(profile, 'config.jsonc'));
  const internal = await evaluate<FolderListing>(`window.viewer.list(${JSON.stringify(profile)})`);
  assert.ok(internal.entries.some((entry) => entry.name === 'config.jsonc'));
  for (const expression of [
    `window.viewer.list(${JSON.stringify(fixture)})`,
    `window.viewer.stat(${JSON.stringify(externalFile)})`,
    `window.viewer.resource(${JSON.stringify(externalFile)})`,
  ]) {
    const result = await evaluate<{ denied: boolean; code?: string }>(
      `(async () => { try { await ${expression}; return {denied:false}; } catch(error) { return {denied:true,code:error.code}; } })()`,
    );
    assert.deepEqual(result, { denied: true, code: 'FILE_ACCESS_REQUIRED' });
  }
  await evaluate('document.querySelector(\'[aria-label="Close plane"]\').click()');
  await until(
    () => evaluate<boolean>('document.body.innerText.includes("No open planes")'),
    Boolean,
    'the empty workspace after closing its initial plane',
  );
  await evaluate(
    'Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === "New folder plane").click()',
  );
  await until(
    () => evaluate<boolean>('document.body.innerText.includes("Allow folder access")'),
    Boolean,
    'the native-grant recovery action',
  );
  const saved = await until(
    () => evaluate<Bootstrap>('window.viewer.bootstrap()'),
    (value) => !!value.state,
    'the initial workspace save',
  );
  await evaluate(`window.viewer.settingsGet().then(snapshot => window.viewer.settingsPatch([
    {path:'settings.search.roots',value:[${JSON.stringify(stress)}]},
    {path:'settings.search.exclusions',value:[]},
    {path:'settings.search.contentRoots',value:[]}
  ],snapshot.revision))`);
  await evaluate(`window.viewer.watch(${JSON.stringify(stress)},'mas-watch-pressure')`);
  await delay(2000);
  const stateWrite = await evaluate<{ saved: boolean; code?: string }>(
    `(async () => { try { await window.viewer.save(${JSON.stringify(saved.state)}); return {saved:true}; } catch(error) { return {saved:false,code:error.code}; } })()`,
  );
  assert.deepEqual(
    stateWrite,
    { saved: true },
    'Workspace saving must survive 2,304 watched files.',
  );
  const handles = native('/usr/sbin/lsof', ['-p', String(child.pid), '-Ff'])
    .split('\n')
    .filter((line) => /^f\d/.test(line)).length;
  assert.ok(handles < 192, `Directory watches must stay bounded; found ${handles} open handles.`);
  await until(
    () => evaluate<IndexStatus>('window.viewer.indexStatus()'),
    (value) =>
      !value.running && value.count >= 2304 && value.roots.every((root) => root.errors === 0),
    'the complete stress index',
  );
  const liveDirectory = path.join(stress, 'new-folder');
  const liveFile = path.join(liveDirectory, 'Live-watch-added.txt');
  await mkdir(liveDirectory);
  await writeFile(liveFile, 'Generated live update.');
  const find = (name: string) =>
    evaluate<IndexedResult>(
      `window.viewer.indexedQuery({query:${JSON.stringify(name)},root:${JSON.stringify(stress)}})`,
    );
  await until(
    () => find('Live-watch-added'),
    (value) => value.entries.some((entry) => entry.path === liveFile),
    'a newly created nested file',
  );
  const renamed = path.join(liveDirectory, 'Live-watch-renamed.txt');
  await rename(liveFile, renamed);
  await until(
    () => find('Live-watch-renamed'),
    (value) => value.entries.some((entry) => entry.path === renamed),
    'the renamed nested file',
  );
  await until(
    () => find('Live-watch-added'),
    (value) => value.entries.length === 0,
    'removal of the old index row',
  );
  await rm(liveDirectory, { recursive: true });
  await until(
    () => find('Live-watch-renamed'),
    (value) => value.entries.length === 0,
    'removal of the deleted subtree',
  );
  await evaluate(`window.viewer.unwatch('mas-watch-pressure')`);
  await evaluate(
    'window.viewer.settingsGet().then(snapshot => window.viewer.settingsPatch([{path:"settings.search.paused",value:true}],snapshot.revision))',
  );
  assert.deepEqual(exceptions, []);
  assert.equal((await stat(path.join(profile, 'config.jsonc'))).mode & 0o777, 0o600);
  assert.equal(await readFile(externalFile, 'utf8'), 'Generated unselected MAS verification file.');
  void command('Browser.close').catch(() => undefined);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Signed Viewer did not quit')), 15000);
    const finish = (code: number | null) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error('Signed Viewer quit with status ' + code));
    };
    if (child.exitCode !== null) finish(child.exitCode);
    else child.once('exit', finish);
  });
  console.log(
    `Signed MAS verification passed: startup, private container configuration, actual home, unselected-folder/file denial, permission recovery UI, 2,304 generated files under a 512-handle limit (${handles} open handles), workspace saves, live nested add/rename/delete and graceful Quit. Native picker/bookmark acceptance remains a separate check.`,
  );
} catch (error) {
  if (socket?.readyState === WebSocket.OPEN)
    console.error(
      'MAS renderer state:',
      await evaluate(
        '({title:document.title,text:document.body.innerText.slice(0,2000),nativeAPI:!!window.viewerNative,rendererAPI:!!window.viewer})',
      ).catch(() => 'Renderer diagnostics unavailable.'),
    );
  console.error(output.slice(-3500));
  throw error;
} finally {
  socket?.close();
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  }
  await rm(profile, { recursive: true, force: true });
  await rm(fixture, { recursive: true, force: true });
}
