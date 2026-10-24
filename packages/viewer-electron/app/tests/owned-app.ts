/** Native supplemental checks own their profile, loopback debugger and app. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { adoptGeneratedProfile, type NativeWindowMode } from './native/runtime/owned-application';

interface DebugTarget {
  id: string;
  url: string;
  webSocketDebuggerUrl: string;
}
interface RuntimeResult<T> {
  result: { value: T };
  exceptionDetails?: { exception?: { description?: string }; text?: string };
}
export async function ownedApp(
  binary: string,
  profile: string,
  options: { mode?: NativeWindowMode } = {},
) {
  const owned = await adoptGeneratedProfile({
    binary,
    profile,
    mode: options.mode ?? 'hidden',
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
    socket.addEventListener('message', (event) => {
      const reply = JSON.parse(String(event.data)) as {
        id: number;
        error?: { message: string };
        result?: unknown;
      };
      const request = pending.get(reply.id);
      if (!request) return;
      pending.delete(reply.id);
      if (reply.error) request.reject(new Error(reply.error.message));
      else request.resolve(reply.result);
    });
    socket.addEventListener('close', () => {
      for (const request of pending.values()) request.reject(new Error('Owned debugger closed'));
      pending.clear();
    });
    const command = <T = unknown>(
      method: string,
      params: Record<string, unknown> = {},
      sessionId?: string,
    ) =>
      new Promise<T>((resolve, reject) => {
        const current = ++id,
          timeout = setTimeout(() => {
            pending.delete(current);
            reject(new Error('Owned CDP timeout ' + method));
          }, 15000);
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
    const evaluate = async <T = unknown>(
      expression: string,
      options: { contextId?: number; sessionId?: string; userGesture?: boolean } = {},
    ): Promise<T> => {
      const reply = await command<RuntimeResult<T>>(
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
    };
    await command('Emulation.setFocusEmulationEnabled', { enabled: true });
    // A debugger target exists before loadURL resolves. Browser.close during
    // that interval can close only the loading Mac window rather than Quit.
    await until(
      () => evaluate<string>('document.readyState'),
      (state) => state === 'complete',
      'owned renderer finished loading',
    );
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>resolve(true)))');
    return { command, evaluate, targetID: target.id };
  }
  async function close(connection?: Awaited<ReturnType<typeof connect>>) {
    try {
      if (connection) void connection.command('Browser.close').catch(() => undefined);
      for (let i = 0; i < 300 && child.exitCode === null && child.signalCode === null; i++)
        await delay(50);
      if (child.exitCode === null && child.signalCode === null) {
        await launched.stop();
        throw new Error(
          'Owned app needed termination instead of graceful Quit. Recent app output: ' +
            launched.output(),
        );
      }
      assert.equal(child.exitCode, 0, 'Owned app quit cleanly');
    } finally {
      for (const socket of sockets) socket.close();
      await launched.stop();
    }
  }
  return { child, port, connect, close, evidenceDirectory: owned.evidenceDirectory };
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
