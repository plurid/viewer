/** Native supplemental checks own their profile, loopback debugger and app. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { adoptGeneratedProfile, type NativeWindowMode } from './native/runtime/owned-application';
import { animationFrames } from './native/runtime/page';
import type { PageExpression } from './native/runtime/page-function';
import { pageCall } from './native/runtime/page-function';

interface DebugTarget {
  id: string;
  url: string;
  webSocketDebuggerUrl: string;
}
interface RuntimeResult<T> {
  result: { value: T };
  exceptionDetails?: { exception?: { description?: string }; text?: string };
}
interface EvaluateOptions {
  contextId?: number;
  sessionId?: string;
  userGesture?: boolean;
}

/** Records where a process waits, with macOS `sample`: the file, or undefined when it failed. */
function sampleProcess(pid: number, file: string): Promise<string | undefined> {
  return new Promise((resolve) =>
    execFile('/usr/bin/sample', [String(pid), '2', '-file', file], { timeout: 20000 }, (error) =>
      resolve(error ? undefined : file),
    ),
  );
}
export async function ownedApp(
  binary: string,
  profile: string,
  options: { mode?: NativeWindowMode; environment?: NodeJS.ProcessEnv } = {},
) {
  const owned = await adoptGeneratedProfile({
    binary,
    profile,
    mode: options.mode ?? 'hidden',
    environment: options.environment,
    label: 'native-supplemental',
    evidenceRoot: path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../out/native-evidence',
    ),
  });
  const launched = await owned.launch();
  const { child, port } = launched;
  const sockets: WebSocket[] = [];
  async function connect(settings = false, targetID?: string) {
    let target: DebugTarget | undefined;
    for (let i = 0; i < 200 && !target; i++) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(
          `Owned app exited before connection (${child.exitCode ?? child.signalCode}): ${launched.output()}`,
        );
      const targets: DebugTarget[] = await fetch(`http://127.0.0.1:${port}/json/list`)
        .then((r) => r.json())
        .catch(() => []);
      target = targets.find(
        (t) =>
          t.url.startsWith('viewer-app://app/') &&
          t.url.includes('window=settings') === settings &&
          (!targetID || t.id === targetID),
      );
      if (!target) await delay(100);
    }
    assert.ok(target, 'Owned renderer started');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener(
        'error',
        () => reject(new Error('Owned debugger connection failed')),
        { once: true },
      );
    });
    let id = 0;
    const pending = new Map<
      number,
      { resolve(value: unknown): void; reject(error: Error): void }
    >();
    const listeners = new Set<(method: string, params: Record<string, unknown>) => void>();
    socket.addEventListener('message', (event) => {
      const reply = JSON.parse(String(event.data)) as {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
        error?: { message: string };
        result?: unknown;
      };
      if (reply.method) {
        for (const listener of listeners) listener(reply.method, reply.params ?? {});
        return;
      }
      if (reply.id === undefined) return;
      const request = pending.get(reply.id);
      if (!request) return;
      pending.delete(reply.id);
      if (reply.error) request.reject(new Error(reply.error.message));
      else request.resolve(reply.result);
    });
    socket.addEventListener('close', () => {
      for (const request of pending.values()) request.reject(new Error('Owned debugger closed'));
      pending.clear();
      listeners.clear();
    });
    const command = <T = unknown>(
      method: string,
      params: Record<string, unknown> = {},
      sessionId?: string,
    ) =>
      new Promise<T>((resolve, reject) => {
        const current = ++id,
          timeout = setTimeout(
            () => {
              pending.delete(current);
              reject(new Error('Owned CDP timeout ' + method));
            },
            method === 'HeapProfiler.takeHeapSnapshot' ? 120000 : 15000,
          );
        pending.set(current, {
          resolve: (value) => {
            clearTimeout(timeout);
            resolve(value as T);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
        });
        socket.send(JSON.stringify({ id: current, method, params, sessionId }));
      });
    function evaluate<R>(
      expression: PageExpression<R>,
      options?: EvaluateOptions,
    ): Promise<Awaited<R>>;
    function evaluate<T = unknown>(expression: string, options?: EvaluateOptions): Promise<T>;
    async function evaluate(expression: string, options: EvaluateOptions = {}) {
      const reply = await command<RuntimeResult<unknown>>(
        'Runtime.evaluate',
        {
          expression,
          contextId: options.contextId,
          awaitPromise: true,
          returnByValue: true,
          userGesture: options.userGesture ?? true,
        },
        options.sessionId,
      );
      if (reply.exceptionDetails)
        throw new Error(
          reply.exceptionDetails.exception?.description || reply.exceptionDetails.text,
        );
      return reply.result.value;
    }
    await command('Emulation.setFocusEmulationEnabled', { enabled: true });
    // A debugger target exists before loadURL resolves. Browser.close during
    // that interval can close only the loading Mac window rather than Quit.
    await until(
      () => evaluate(pageCall(() => document.readyState)),
      (state) => state === 'complete',
      'owned renderer finished loading',
    );
    await evaluate(animationFrames(1));
    const onEvent = (listener: (method: string, params: Record<string, unknown>) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    };
    return { command, evaluate, onEvent, targetID: target.id };
  }
  async function close(connection?: Awaited<ReturnType<typeof connect>>) {
    try {
      if (connection) void connection.command('Browser.close').catch(() => undefined);
      const running = () => child.exitCode === null && child.signalCode === null;
      let sample: string | undefined;
      for (let i = 0; i < 300 && running(); i++) {
        await delay(50);
        // A Quit still running after five seconds is sampled before termination, so a rare
        // hang shows where it waits.
        if (i === 100 && running() && process.platform === 'darwin' && child.pid)
          sample = await sampleProcess(
            child.pid,
            path.join(owned.evidenceDirectory, 'quit-sample.txt'),
          );
      }
      if (running()) {
        await launched.stop();
        throw new Error(
          'Owned app needed termination instead of graceful Quit.' +
            (sample ? ' Where it waited: ' + sample + '.' : '') +
            ' Recent app output: ' +
            launched.output(),
        );
      }
      assert.equal(child.exitCode, 0, 'Owned app quit cleanly');
    } finally {
      for (const socket of sockets) socket.close();
      await launched.stop();
    }
  }
  return {
    child,
    port,
    connect,
    close,
    /** The app's recent stdout and stderr, for diagnostics such as VIEWER_PERF reports. */
    output: () => launched.output(),
    evidenceDirectory: owned.evidenceDirectory,
  };
}
export async function until<T>(
  read: () => Promise<T>,
  predicate: (value: T) => unknown,
  label: string,
  milliseconds = 15000,
): Promise<T> {
  const deadline = Date.now() + milliseconds;
  let value: T;
  do {
    value = await read();
    if (predicate(value)) return value;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(label + ': ' + JSON.stringify(value!));
}
