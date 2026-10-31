/** Signed MAS startup, handle-pressure and permission-boundary checks. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, stat, symlink, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import store from '../mac-app-store.json' with { type: 'json' };
import type { Bootstrap, RendererOperationRequest, SavedState } from '../src/domain/contracts';
import type { TerminalEvent, TerminalStart } from '../src/domain/automation/actions';
import { AwakeClock, QualificationInterrupted } from './awake-clock';
import { click, exists, focus, patchSettings, pressButton } from './native/runtime/page';
import { pageCall } from './native/runtime/page-function';
import type { PageExpression } from './native/runtime/page-function';
import {
  ownedDirectory,
  temporaryRoot,
  trashTemporary,
  trashFixtureEntry,
} from '../tools/temporary';
import { terminalConfirmation } from '../src/desktop/actions/execution-confirmations';

assert.equal(process.platform, 'darwin', 'The signed MAS check requires macOS.');
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle =
  process.env.VIEWER_TEST_MAS_BUNDLE ||
  path.join(appRoot, 'out/mac-app-store/mas-dev', process.arch, 'Viewer.app');
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
const fixture = await temporaryRoot('viewer-mas-native-', '/private/tmp');
const externalFile = path.join(fixture, 'Unselected.txt');
await writeFile(externalFile, 'Generated unselected MAS verification file.', { mode: 0o600 });
// Owned like a temporary root, so scenario steps may remove entries inside it.
await ownedDirectory(profile);
// The disposable shell starts without anyone to confirm it, so only this run's own
// profile records the first-run confirmation that a configured profile requires.
const disposableShell = {
  executable: '/bin/sh',
  args: ['--noprofile', '--norc'],
  env: { HISTFILE: '/dev/null', ENV: '' },
};
await writeFile(
  path.join(profile, 'confirmed-actions-v1.json'),
  JSON.stringify([terminalConfirmation(disposableShell)]),
  { mode: 0o600, flag: 'wx' },
);
// Only generated files in this isolated app container are indexed. A large flat
// directory also exercises plane watches, separately from recursive indexing.
const stress = path.join(profile, 'watch-pressure');
await mkdir(stress);
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
let launchedAt = Date.now();
const launch = () =>
  spawn(
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
let child = launch();
let output = '';
function captureOutput() {
  child.stdout!.on('data', (value) => (output += String(value)));
  child.stderr!.on('data', (value) => (output += String(value)));
}
captureOutput();
let socket: WebSocket | undefined;
let next = 0;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
const exceptions: string[] = [];
let passed = false;

interface MasWindow {
  __masOwnedChildEvents: TerminalEvent[];
  __masTerminalEvents: TerminalEvent[];
}
type GuardedRead = 'list' | 'stat' | 'resource';
const operate = (request: RendererOperationRequest) => window.viewer.operate(request);
const viewerJobs = () => window.viewer.jobs();
const undo = (id: string) => window.viewer.undo(id);
const bootstrap = () => window.viewer.bootstrap();
const terminalWrite = (id: string, data: string) => window.viewer.terminalWrite(id, data);
const pageIncludes = (text: string) => document.body.innerText.includes(text);
/** Reads `file` through `method`: whether the sandbox refused it, and with which code. */
async function refusal(method: GuardedRead, file: string) {
  try {
    await window.viewer[method](file);
    return { denied: false };
  } catch (error) {
    return { denied: true, code: (error as { code?: string }).code };
  }
}
/** Saves the workspace: whether it was saved, or the refusal's code. */
async function trySave(state: SavedState) {
  try {
    await window.viewer.save(state);
    return { saved: true };
  } catch (error) {
    return { saved: false, code: (error as { code?: string }).code };
  }
}
/** Opens, reads and releases `file` as a resource `count` times. */
async function resourceCycles(file: string, count: number) {
  for (let cycle = 0; cycle < count; cycle++) {
    const resource = await window.viewer.resource(file);
    await window.viewer.read(resource.id);
    await window.viewer.release(resource.id);
  }
}
/** One soak cycle: a watch, ten resource reads of `file` and a workspace save. */
async function soakCycle(folder: string, file: string, state: SavedState) {
  await window.viewer.watch(folder, 'mas-soak');
  for (let i = 0; i < 10; i++) {
    const item = await window.viewer.resource(file);
    await window.viewer.read(item.id);
    await window.viewer.release(item.id);
  }
  await window.viewer.unwatch('mas-soak');
  await window.viewer.save(state);
}
/** Starts the terminal, recording its events in `window.__masOwnedChildEvents`. */
function startOwnedTerminal(start: TerminalStart) {
  const page = window as unknown as MasWindow;
  page.__masOwnedChildEvents = [];
  window.viewer.onEvent((event) => {
    if (event.type === 'terminal' && event.event.id === start.id)
      page.__masOwnedChildEvents.push(event.event);
  });
  return window.viewer.terminalStart(start);
}
/** Starts the terminal, recording every terminal event in `window.__masTerminalEvents`. */
function startTerminal(start: TerminalStart) {
  const page = window as unknown as MasWindow;
  page.__masTerminalEvents = [];
  window.viewer.onEvent((event) => {
    if (event.type === 'terminal') page.__masTerminalEvents.push(event.event);
  });
  return window.viewer.terminalStart(start);
}
/** The output the owned terminal has written so far. */
const ownedOutput = () =>
  (window as unknown as MasWindow).__masOwnedChildEvents
    .flatMap((event) => (event.type === 'data' ? [event.data] : []))
    .join('');

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
function evaluate<R>(expression: PageExpression<R>): Promise<Awaited<R>>;
async function evaluate(expression: string): Promise<unknown> {
  const reply = await command<{ result: { value: unknown }; exceptionDetails?: unknown }>(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true, userGesture: true },
  );
  assert.equal(reply.exceptionDetails, undefined, 'Renderer evaluation failed');
  return reply.result.value;
}
async function operation(request: RendererOperationRequest) {
  const id = await evaluate(pageCall(operate, request));
  const job = await until(
    () => evaluate(pageCall(viewerJobs)),
    (jobs) =>
      jobs.some(
        (job) => job.id === id && ['completed', 'failed', 'cancelled'].includes(job.status),
      ),
    'native ' + request.kind,
  );
  const result = job.find((job) => job.id === id)!;
  assert.equal(result.status, 'completed', JSON.stringify(result.errors));
  return result;
}
async function nativeMetadataAndUndo() {
  const source = path.join(profile, 'Viewer-QA-' + randomUUID()),
    destination = path.join(profile, 'transfer-destination');
  await mkdir(source);
  await mkdir(destination);
  const filename = 'Viewer-QA-payload-' + randomUUID() + '.txt';
  const file = path.join(source, filename);
  await writeFile(file, 'Generated metadata fidelity fixture.');
  await chmod(file, 0o640);
  await symlink(filename, path.join(source, 'relative-link'));
  native('/usr/bin/xattr', ['-w', 'com.viewer.qa', 'owned metadata', file]);
  native('/usr/bin/xattr', ['-w', 'com.viewer.qa', 'owned folder metadata', source]);
  native('/bin/chmod', ['+a', 'everyone allow read,readattr,readextattr,readsecurity', file]);
  native('/usr/bin/xattr', [
    '-wx',
    'com.apple.ResourceFork',
    Buffer.from('Viewer generated resource fork').toString('hex'),
    file,
  ]);
  const copied = await operation({ kind: 'copy', sources: [source], destination });
  const target = path.join(destination, path.basename(source), filename);
  assert.equal(await readFile(target, 'utf8'), await readFile(file, 'utf8'));
  assert.equal((await stat(target)).mode & 0o777, (await stat(file)).mode & 0o777);
  for (const attribute of ['com.viewer.qa', 'com.apple.ResourceFork'])
    assert.equal(
      native('/usr/bin/xattr', ['-px', attribute, target]),
      native('/usr/bin/xattr', ['-px', attribute, file]),
    );
  assert.equal(
    native('/usr/bin/xattr', ['-p', 'com.viewer.qa', path.dirname(target)]),
    native('/usr/bin/xattr', ['-p', 'com.viewer.qa', source]),
  );
  const acl = (file: string) =>
    native('/bin/ls', ['-le', file])
      .split('\n')
      .filter((line) => /^\s*\d+:/.test(line));
  assert.deepEqual(acl(target), acl(file));
  assert.equal(
    await evaluate(
      pageCall(
        (file: string) => window.viewer.stat(file).then((entry) => entry.name),
        path.join(path.dirname(target), 'relative-link'),
      ),
    ),
    'relative-link',
  );
  assert.ok(copied.undoable);
  // Exercise actual native Trash receipts, not a fake test adapter. Undo restores
  // these generated items immediately; no ordinary Trash contents are touched.
  for (const item of [target, source]) {
    const trashed = await operation({ kind: 'trash', sources: [item] });
    assert.ok(trashed.undoable, 'Native Trash must yield a guarded private receipt.');
    await evaluate(pageCall(undo, trashed.id));
    await stat(item);
  }
}
async function independentMCP() {
  await evaluate(
    patchSettings(
      { path: 'settings.agents.enabled', value: true },
      { path: 'settings.agents.roots', value: [stress] },
    ),
  );
  await until(
    () => readFile(path.join(profile, 'agent-connection-v1.json'), 'utf8'),
    Boolean,
    'the signed agent socket',
  );
  const token = JSON.parse(
    await readFile(path.join(profile, 'agent-token-v1.json'), 'utf8'),
  ) as string;
  const requests = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'Viewer qualification', version: '1' },
      },
    },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_config', arguments: {} } },
  ];
  async function client(credential: string) {
    const processClient = spawn(path.join(bundle, 'Contents/MacOS/Viewer'), ['--mcp'], {
      env: { ...process.env, VIEWER_DATA_DIRECTORY: profile, VIEWER_AGENT_TOKEN: credential },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    processClient.stdout.on('data', (value) => (stdout += String(value)));
    processClient.stderr.on('data', (value) => (stderr += String(value)));
    processClient.stdin.end(requests.map((request) => JSON.stringify(request)).join('\n') + '\n');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        processClient.kill();
        reject(new Error('Independent signed MCP client timed out.'));
      }, 20000);
      processClient.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      processClient.once('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error('Independent signed MCP client failed: ' + stderr.slice(-500)));
      });
    });
    assert.ok(!stdout.includes(token), 'MCP must not disclose its private token.');
    return stdout
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as {
            id: number;
            error?: unknown;
            result?: { tools?: { name: string }[] };
          },
      );
  }
  const replies = await client(token);
  assert.equal(replies.length, 3);
  assert.ok(replies.every((reply) => !reply.error));
  assert.ok(
    replies
      .find((reply) => reply.id === 2)
      ?.result?.tools?.some((tool) => tool.name === 'read_config'),
  );
  const denied = await client('0'.repeat(64));
  assert.ok(
    denied.every((reply) => !!reply.error),
    'A separate client with the wrong token must be denied.',
  );
}
async function renderedPreview() {
  const file = path.join(stress, 'AAA-Viewer-QA-preview.stl');
  await writeFile(
    file,
    'solid fixture\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid fixture\n',
  );
  await command('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'l',
    code: 'KeyL',
    modifiers: 4,
    windowsVirtualKeyCode: 76,
  });
  await command('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'l',
    code: 'KeyL',
    modifiers: 4,
    windowsVirtualKeyCode: 76,
  });
  await until(
    () => evaluate(exists('dialog input, [role=dialog] input')),
    Boolean,
    'Go to folder dialog',
  );
  await evaluate(focus('dialog input, [role=dialog] input'));
  await command('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'a',
    code: 'KeyA',
    modifiers: 4,
  });
  await command('Input.insertText', { text: stress });
  await evaluate(
    pageCall(() =>
      document.querySelector<HTMLFormElement>('dialog form, [role=dialog] form')!.requestSubmit(),
    ),
  );
  const selector = `[data-file-path=${JSON.stringify(file)}]`;
  await until(() => evaluate(exists(selector)), Boolean, 'generated native preview row');
  await evaluate(click(selector));
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space' });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space' });
  await until(
    () => evaluate(pageCall(pageIncludes, '1 mesh · 1 triangle · 3 vertices')),
    Boolean,
    'rendered signed STL preview',
  );
  await evaluate(click('dialog [aria-label=Close], [role=dialog] [aria-label=Close]'));
}
async function soak(minutes: number, state: Bootstrap['state']) {
  assert.ok(Number.isFinite(minutes) && minutes >= 0 && minutes <= 1440);
  if (!minutes) return;
  const samples: {
    elapsed: number;
    wallElapsed: number;
    handles: number;
    rssKB: number;
    processes: number;
    latencyMs: number;
    heapBytes: number;
  }[] = [];
  const clock = new AwakeClock(),
    duration = minutes * 60000;
  const save = async (
    completed: boolean,
    interruption?: { reason: string; awakeMs: number; wallMs: number },
  ) => {
    if (process.env.VIEWER_TEST_EVIDENCE)
      await writeFile(
        process.env.VIEWER_TEST_EVIDENCE,
        JSON.stringify(
          {
            version: 1,
            minutes,
            clock: 'macOS mach_absolute_time',
            completed,
            cycles: samples.length,
            samples,
            interruption,
          },
          null,
          2,
        ) + '\n',
      );
  };
  let cycle = 0;
  try {
    await save(false);
    await command('Performance.enable');
    while (clock.elapsed().awakeMs < duration) {
      const before = Date.now();
      await evaluate(pageCall(soakCycle, stress, path.join(stress, 'Flat-0.txt'), state!));
      if (cycle % 5 === 0) await renderedPreview();
      const metrics = await command<{ metrics: { name: string; value: number }[] }>(
        'Performance.getMetrics',
      );
      const rows = native('/bin/ps', ['-axo', 'pid=,ppid=,rss='])
        .trim()
        .split('\n')
        .map((line) => line.trim().split(/\s+/).map(Number));
      const owned = new Set([child.pid!]);
      for (let pass = 0; pass < 10; pass++)
        for (const [pid, parent] of rows) if (owned.has(parent)) owned.add(pid);
      const rssKB = rows.filter(([pid]) => owned.has(pid)).reduce((sum, row) => sum + row[2], 0);
      const handles = native('/usr/sbin/lsof', ['-p', String(child.pid), '-Ff'])
        .split('\n')
        .filter((line) => /^f\d/.test(line)).length;
      const elapsed = clock.elapsed();
      const sample = {
        elapsed: elapsed.awakeMs / 1000,
        wallElapsed: elapsed.wallMs / 1000,
        handles,
        rssKB,
        processes: owned.size,
        latencyMs: Date.now() - before,
        heapBytes: metrics.metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value ?? 0,
      };
      samples.push(sample);
      await save(false);
      assert.ok(handles < 192, 'Soak file handles exceeded the bounded service budget.');
      assert.ok(owned.size < 16, 'Soak leaked owned processes.');
      if (cycle > 4)
        assert.ok(
          rssKB < samples[4].rssKB + 512 * 1024,
          'Soak process memory grew by over 512 MiB after warm-up.',
        );
      cycle++;
      if (cycle % 10 === 0)
        console.log(
          `Signed lifecycle soak: ${cycle} cycles, ${Math.round(sample.elapsed / 60)} minutes, ${handles} descriptors.`,
        );
      await delay(Math.min(30000, Math.max(0, duration - elapsed.awakeMs)));
    }
    // Reading before completion also rejects sleep during the final delay.
    clock.elapsed();
    await save(true);
  } catch (error) {
    try {
      clock.elapsed();
    } catch (clockError) {
      if (clockError instanceof QualificationInterrupted) error = clockError;
    }
    if (error instanceof QualificationInterrupted)
      await save(false, { reason: error.message, ...error.elapsed });
    throw error;
  }
  console.log(
    `Signed lifecycle soak completed: ${minutes} minutes, ${cycle} cycles, resource/watch/save lifecycles and rendered STL open/close. Memory measurements include owned renderer/GPU/helper processes.`,
  );
}

async function attachRenderer(role: 'workspace' | 'settings' = 'workspace') {
  const target = await until(
    async () => {
      const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
        url: string;
        webSocketDebuggerUrl: string;
      }[];
      return targets.find(
        (item) =>
          item.url.startsWith('viewer-app://app/') &&
          item.url.includes('window=settings') === (role === 'settings'),
      );
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
  // Keep this isolated hidden renderer focused across real Quit/relaunch without
  // activating the user's desktop or depending on which app has native focus.
  await command('Emulation.setFocusEmulationEnabled', { enabled: true });
}
async function quitOwned() {
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
  socket?.close();
  socket = undefined;
  for (const request of pending.values()) request.reject(new Error('Owned Viewer quit.'));
  pending.clear();
}
async function coldTrashUndo() {
  const file = path.join(profile, 'Viewer-QA-cold-undo-' + randomUUID() + '.txt');
  await writeFile(file, 'Generated cold-start Trash receipt fixture.', { mode: 0o600 });
  const trashed = await operation({ kind: 'trash', sources: [file] });
  assert.ok(trashed.undoable);
  assert.equal(await stat(file).catch(() => undefined), undefined);
  await quitOwned();
  launchedAt = Date.now();
  child = launch();
  captureOutput();
  await attachRenderer();
  await until(
    () =>
      evaluate(
        pageCall(
          () =>
            typeof window.viewer?.jobs === 'function' &&
            !!document.querySelector('.folder-explorer'),
        ),
      ),
    Boolean,
    'the relaunched signed renderer',
  );
  const jobs = await evaluate(pageCall(viewerJobs));
  assert.equal(
    jobs.find((job) => job.id === trashed.id)?.undoable,
    true,
    'Cold launch must recover the guarded native Trash receipt.',
  );
  await evaluate(pageCall(undo, trashed.id));
  assert.equal(await readFile(file, 'utf8'), 'Generated cold-start Trash receipt fixture.');
  console.log('Signed native Trash receipt restored after graceful Quit and cold relaunch.');
}
async function stoppedTerminalChildren() {
  const id = 'mas-pty-child-' + randomUUID();
  await evaluate(
    pageCall(startOwnedTerminal, {
      id,
      workspaceID: 'mas-qa',
      rootID: 'mas-qa',
      profileID: 'mas-qa',
      cwd: stress,
      cols: 80,
      rows: 24,
    }),
  );
  await evaluate(
    pageCall(
      terminalWrite,
      id,
      'set +H\nsleep 180 & printf "VIEWER_QA_OWNED_PIDS=%s,%s\\n" "$$" "$!"; wait\n',
    ),
  );
  const text = await until(
    () => evaluate(pageCall(ownedOutput)),
    (value) => /VIEWER_QA_OWNED_PIDS=(\d+),(\d+)/.test(value),
    'the generated terminal child process',
  );
  const pids = text
    .match(/VIEWER_QA_OWNED_PIDS=(\d+),(\d+)/)!
    .slice(1)
    .map(Number);
  assert.ok(pids.every((pid) => Number.isSafeInteger(pid) && pid > 1));
  await evaluate(pageCall((id: string) => window.viewer.terminalClose(id), id));
  await until(
    async () =>
      pids.every((pid) => {
        try {
          process.kill(pid, 0);
          return false;
        } catch (error) {
          return (error as NodeJS.ErrnoException).code === 'ESRCH';
        }
      }),
    Boolean,
    'the owned shell and child to stop after closing the terminal',
  );
  console.log('Signed terminal close stopped its generated shell and background child.');
}
try {
  await attachRenderer();
  await until(
    () =>
      evaluate(
        pageCall(
          () =>
            !!window.viewer &&
            !!document.querySelector('[aria-label="Close plane"]') &&
            document.body.innerText.includes('Allow folder access'),
        ),
      ),
    Boolean,
    'the initial folder permission request',
  );
  const started = await evaluate(pageCall(bootstrap));
  console.log('Signed startup readiness: ' + (Date.now() - launchedAt) + ' ms.');
  assert.equal(started.home, os.homedir(), 'MAS must preserve the actual home location.');
  const settings = await evaluate(pageCall(() => window.viewer.settingsGet()));
  assert.equal(settings.config?.path, path.join(profile, 'config.jsonc'));
  const internal = await evaluate(
    pageCall((folder: string) => window.viewer.list(folder), profile),
  );
  assert.ok(internal.entries.some((entry) => entry.name === 'config.jsonc'));
  const guarded: [GuardedRead, string][] = [
    ['list', fixture],
    ['stat', externalFile],
    ['resource', externalFile],
  ];
  for (const [method, file] of guarded) {
    const result = await evaluate(pageCall(refusal, method, file));
    assert.deepEqual(result, { denied: true, code: 'FILE_ACCESS_REQUIRED' });
  }
  // Exercise both native pasteboard-version queries during a real sandbox
  // revocation, without reading or overwriting the user's clipboard contents.
  await evaluate(pageCall(() => window.viewer.openSettings()));
  socket?.close();
  await attachRenderer('settings');
  await until(
    () => evaluate(pageCall(() => !!document.querySelector('.settings-window') && !!window.viewer)),
    Boolean,
    'the signed Settings revocation boundary',
  );
  await evaluate(pageCall((folder: string) => window.viewer.fileAccessRevoke(folder), fixture));
  // Closing can destroy this debugger target before it acknowledges evaluation.
  void evaluate(pageCall(() => window.close())).catch(() => undefined);
  await until(
    async () =>
      (
        (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { url: string }[]
      ).some((target) => target.url.includes('window=settings')),
    (present) => !present,
    'the closed signed Settings window',
  );
  socket?.close();
  await attachRenderer();
  const revoked = await evaluate(pageCall(refusal, 'list', fixture));
  assert.deepEqual(revoked, { denied: true, code: 'FILE_ACCESS_REQUIRED' });
  await evaluate(click('[aria-label="Close plane"]'));
  await until(
    () => evaluate(pageCall(pageIncludes, 'No open planes')),
    Boolean,
    'the empty workspace after closing its initial plane',
  );
  await evaluate(pressButton('New folder plane'));
  await until(
    () => evaluate(pageCall(pageIncludes, 'Allow folder access')),
    Boolean,
    'the native-grant recovery action',
  );
  const saved = await until(
    () => evaluate(pageCall(bootstrap)),
    (value) => !!value.state,
    'the initial workspace save',
  );
  const volumes = await evaluate(pageCall(() => window.viewer.volumesList()));
  assert.ok(
    volumes.some((volume) => volume.path === '/' && volume.total > 0 && volume.available >= 0),
    'Mounted volumes must be visible without a /Volumes picker grant.',
  );
  await evaluate(
    patchSettings(
      {
        path: 'settings.terminals.profiles',
        value: [{ id: 'mas-qa', name: 'Disposable MAS shell', ...disposableShell }],
      },
      { path: 'settings.terminals.profileID', value: 'mas-qa' },
    ),
  );
  const terminalID = 'mas-pty-' + randomUUID();
  await evaluate(
    pageCall(startTerminal, {
      id: terminalID,
      workspaceID: 'mas-qa',
      rootID: 'mas-qa',
      profileID: 'mas-qa',
      cwd: stress,
      cols: 80,
      rows: 24,
    }),
  );
  await evaluate(pageCall(terminalWrite, terminalID, "printf 'VIEWER_MAS_PTY_OK\\n'; pwd; exit\n"));
  const terminalEvents = await until(
    () => evaluate(pageCall(() => (window as unknown as MasWindow).__masTerminalEvents)),
    (events) =>
      events.some((event) => event.type === 'exit') ||
      events.some((event) => event.type === 'error'),
    'the actual signed sandbox PTY',
  );
  assert.equal(
    terminalEvents.find((event) => event.type === 'error'),
    undefined,
    JSON.stringify(terminalEvents),
  );
  assert.ok(
    terminalEvents
      .filter((event) => event.type === 'data')
      .map((event) => event.data)
      .join('')
      .includes('VIEWER_MAS_PTY_OK'),
  );
  assert.ok(terminalEvents.some((event) => event.type === 'exit' && event.code === 0));
  await stoppedTerminalChildren();
  const previewFile = path.join(stress, 'Flat-0.txt');
  await evaluate(pageCall(resourceCycles, previewFile, 40));
  await evaluate(
    patchSettings(
      { path: 'settings.search.roots', value: [stress] },
      { path: 'settings.search.exclusions', value: [] },
      { path: 'settings.search.contentRoots', value: [] },
    ),
  );
  await evaluate(
    pageCall((folder: string) => window.viewer.watch(folder, 'mas-watch-pressure'), stress),
  );
  await delay(2000);
  const stateWrite = await evaluate(pageCall(trySave, saved.state!));
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
    () => evaluate(pageCall(() => window.viewer.indexStatus())),
    (value) =>
      !value.running && value.count >= 2304 && value.roots.every((root) => root.errors === 0),
    'the complete stress index',
  );
  const liveDirectory = path.join(stress, 'new-folder');
  const liveFile = path.join(liveDirectory, 'Live-watch-added.txt');
  await mkdir(liveDirectory);
  await writeFile(liveFile, 'Generated live update.');
  const find = (name: string) =>
    evaluate(
      pageCall(
        (query: string, root: string) => window.viewer.indexedQuery({ query, root }),
        name,
        stress,
      ),
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
  await trashFixtureEntry(liveDirectory);
  await until(
    () => find('Live-watch-renamed'),
    (value) => value.entries.length === 0,
    'removal of the deleted subtree',
  );
  await evaluate(pageCall(() => window.viewer.unwatch('mas-watch-pressure')));
  await evaluate(patchSettings({ path: 'settings.search.paused', value: true }));
  await nativeMetadataAndUndo();
  await independentMCP();
  await coldTrashUndo();
  await soak(Number(process.env.VIEWER_TEST_SOAK_MINUTES ?? 0), saved.state);
  assert.deepEqual(exceptions, []);
  assert.equal((await stat(path.join(profile, 'config.jsonc'))).mode & 0o777, 0o600);
  assert.equal(await readFile(externalFile, 'utf8'), 'Generated unselected MAS verification file.');
  await quitOwned();
  console.log(
    `Signed MAS verification passed: startup, private container configuration, actual home, unselected-folder/file denial, permission recovery UI, native volume inventory, actual PTY command/output/exit and owned-child disposal, 40 preview lifecycles, 2,304 generated files under a 512-handle limit (${handles} open handles), workspace saves, live nested add/rename/delete, native xattrs/resource-fork/ACL/mode/link copying, actual Trash Undo including cold relaunch, separate signed authenticated/denied MCP clients and graceful Quit. Native picker/bookmark acceptance remains a separate check.`,
  );
  passed = true;
} catch (error) {
  if (socket?.readyState === WebSocket.OPEN)
    console.error(
      'MAS renderer state:',
      await evaluate(
        pageCall(() => ({
          title: document.title,
          text: document.body.innerText.slice(0, 2000),
          nativeAPI: !!window.viewerNative,
          rendererAPI: !!window.viewer,
          ownedChildEvents: (window as unknown as MasWindow).__masOwnedChildEvents,
        })),
      ).catch(() => 'Renderer diagnostics unavailable.'),
    );
  console.error(output.slice(-3500));
  throw error;
} finally {
  socket?.close();
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise<void>((resolve) => child.once('exit', () => resolve())),
      delay(5000),
    ]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    }
  }
  if (passed) await trashTemporary(profile);
  else
    console.error('Owned failed-test profile retained for receipt/recovery inspection: ' + profile);
  await trashTemporary(fixture);
}
