/** Cold-restart checks of the packaged app, using hidden windows and an owned profile. */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { defaultSettings } from '../src/domain/services';
import type { WindowFrame } from '../src/desktop/windows/window-state';
import { createFixtures } from './fixtures';
import { trashTemporary } from '../tools/temporary';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary =
  process.env.VIEWER_TEST_BINARY ||
  path.join(appRoot, `out/Viewer-darwin-${process.arch}/Viewer.app/Contents/MacOS/Viewer`);
const fixture = await createFixtures();
const profile = path.join(fixture.root, 'profile');
const stateFile = path.join(profile, 'window-state-v1.json');
const captures = path.resolve(appRoot, '../../..', '.impeccable/review');
const execNative = promisify(execFile);
let log = '';
await mkdir(profile);
await mkdir(captures, { recursive: true });
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(fixture.state));
await writeFile(
  path.join(profile, 'settings-v1.json'),
  JSON.stringify({
    version: 1,
    revision: 0,
    settings: defaultSettings(fixture.files),
    ui: fixture.state.ui,
  }),
);
async function launch(expected?: WindowFrame['bounds']): Promise<WindowFrame> {
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const child = spawn(
    binary,
    [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'],
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
  child.stdout.on('data', (data) => {
    log += String(data);
  });
  child.stderr.on('data', (data) => {
    log += String(data);
  });
  child.once('error', (error) => {
    log += String(error);
  });
  let socket: WebSocket | undefined;
  let next = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const exceptions: string[] = [];
  const command = <T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = ++next;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 10000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      socket!.send(JSON.stringify({ id, method, params }));
    });
  async function until<T>(read: () => Promise<T>, accepts: (value: T) => boolean): Promise<T> {
    const deadline = Date.now() + 20000;
    let last: unknown;
    while (Date.now() < deadline) {
      try {
        const result = await read();
        if (accepts(result)) return result;
        last = result;
      } catch (error) {
        last = error;
      }
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`Unexpected exit: ${log.slice(-2000)}`);
      await delay(100);
    }
    throw new Error(`Timed out waiting for native state: ${JSON.stringify(last)}`);
  }
  async function evaluate<T>(expression: string): Promise<T> {
    const reply = await command<{ result: { value: T }; exceptionDetails?: unknown }>(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
    );
    assert.equal(reply.exceptionDetails, undefined);
    return reply.result.value;
  }
  try {
    const target = await until(async () => {
      const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
        type: string;
        webSocketDebuggerUrl: string;
      }[];
      return targets.find((target) => target.type === 'page');
    }, Boolean);
    socket = new WebSocket(target!.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket!.addEventListener('open', () => resolve(), { once: true });
      socket!.addEventListener(
        'error',
        () => reject(new Error('Native debugging connection failed')),
        { once: true },
      );
    });
    socket.addEventListener('message', (event) => {
      const reply = JSON.parse(String(event.data));
      const entry = pending.get(reply.id);
      if (entry) {
        pending.delete(reply.id);
        if (reply.error) entry.reject(new Error(reply.error.message));
        else entry.resolve(reply.result);
      }
      if (reply.method === 'Runtime.exceptionThrown') exceptions.push(JSON.stringify(reply.params));
    });
    socket.addEventListener('close', () => {
      for (const entry of pending.values()) entry.reject(new Error('Debug connection closed'));
      pending.clear();
    });
    await command('Runtime.enable');
    await until(() => evaluate<boolean>('!!document.querySelector("[data-file-path]")'), Boolean);
    // Offscreen Chromium reports screenX/screenY as zero; the main process
    // captures real native coordinates on Quit. Renderer dimensions still apply.
    const size = await evaluate<{ width: number; height: number }>(
      '({width:window.outerWidth,height:window.outerHeight})',
    );
    if (expected)
      assert.deepEqual(
        size,
        { width: expected.width, height: expected.height },
        'The native window must restore its previous size on cold launch',
      );
    const { stdout } = await execNative(
      'osascript',
      [
        '-l',
        'JavaScript',
        '-e',
        `ObjC.import('AppKit');const instance=$.NSRunningApplication.runningApplicationWithProcessIdentifier(${child.pid});JSON.stringify({active:Boolean(instance.active),policy:Number(instance.activationPolicy)});`,
      ],
      { timeout: 5000 },
    );
    assert.deepEqual(JSON.parse(stdout.trim()), { active: false, policy: 1 });
    assert.deepEqual(exceptions, []);
    void command('Browser.close').catch(() => undefined);
    await until(
      async () => child.exitCode,
      (code) => code === 0,
    );
    const saved = JSON.parse(await readFile(stateFile, 'utf8')) as WindowFrame;
    assert.deepEqual({ width: saved.bounds.width, height: saved.bounds.height }, size);
    if (expected)
      assert.deepEqual(
        saved.bounds,
        expected,
        'Real native frame capture on Quit must match the restored placement',
      );
    console.log(
      `Native cold restart and Quit: ${JSON.stringify(saved.bounds)}; hidden and inactive.`,
    );
    return saved;
  } finally {
    socket?.close();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await delay(200);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  }
}
try {
  const first = await launch();
  const rectangle = { ...first, bounds: first.display.workArea };
  await writeFile(stateFile, JSON.stringify(rectangle));
  await launch(rectangle.bounds);
  await launch(rectangle.bounds);
  const area = first.display.workArea;
  const ordinary = {
    ...first,
    bounds: {
      x: area.x + 40,
      y: area.y + 40,
      width: Math.min(1000, area.width - 80),
      height: Math.min(700, area.height - 80),
    },
  };
  if (ordinary.bounds.width >= 780 && ordinary.bounds.height >= 560) {
    await writeFile(stateFile, JSON.stringify(ordinary));
    await launch(ordinary.bounds);
    await launch(ordinary.bounds);
  }
  console.log(
    'Window placement: Rectangle-sized and ordinary frames survive real packaged process restarts.',
  );
} finally {
  await writeFile(path.join(captures, 'desktop-native-window-state.log'), log);
  await trashTemporary(fixture.root);
}
