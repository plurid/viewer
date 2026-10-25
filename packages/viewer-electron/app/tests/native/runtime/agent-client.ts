import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { assertOwnedFixtureDirectory } from '../../../tools/temporary';

/** Actual packaged stdio client, scoped to a profile created by this acceptance process. */
export function packagedAgentClient(binary: string, profile: string, token: string) {
  assertOwnedFixtureDirectory(profile);
  assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
  assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
  assert.match(token, /^[a-f0-9]{64}$/);
  const child = spawn(binary, ['--mcp'], {
    env: {
      ...process.env,
      VIEWER_DATA_DIRECTORY: profile,
      VIEWER_AGENT_TOKEN: token,
      VIEWER_RENDER_TEST: '1',
      VIEWER_BACKGROUND_TEST: '1',
      VIEWER_TEST_PRESERVE: '1',
      VIEWER_TEST_NO_REMOVAL: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  let sequence = 0;
  let buffer = '';
  let totalBytes = 0;
  let stopped: Error | undefined;
  const fail = (message: string) => {
    stopped ??= new Error(message);
    for (const request of pending.values()) request.reject(stopped);
    pending.clear();
  };
  const closed = new Promise<void>((resolve) => {
    child.once('close', () => {
      fail('Packaged MCP client disconnected.');
      resolve();
    });
  });
  child.once('error', () => fail('Packaged MCP client could not start.'));
  child.stdin.on('error', () => fail('Packaged MCP input disconnected.'));
  child.stderr.on('data', (chunk: Buffer) => {
    totalBytes += chunk.length;
    if (totalBytes > 1024 * 1024) {
      fail('Packaged MCP diagnostic output exceeded the test budget.');
      child.kill('SIGTERM');
    }
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    totalBytes += Buffer.byteLength(chunk);
    buffer += chunk;
    if (buffer.includes(token)) {
      fail('Packaged MCP output exposed its authentication credential.');
      child.kill('SIGTERM');
      return;
    }
    if (totalBytes > 1024 * 1024) {
      fail('Packaged MCP output exceeded the test budget.');
      child.kill('SIGTERM');
      return;
    }
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        const reply = JSON.parse(line) as {
          id: number;
          result?: unknown;
          error?: { message: string };
        };
        const request = pending.get(reply.id);
        if (!request) continue;
        pending.delete(reply.id);
        if (reply.error) request.reject(new Error(reply.error.message));
        else request.resolve(reply.result);
      } catch {
        fail('Packaged MCP returned an invalid protocol reply.');
        child.kill('SIGTERM');
        return;
      }
    }
  });

  const request = <T>(method: string, params: Record<string, unknown>): Promise<T> => {
    if (stopped) return Promise.reject(stopped);
    const id = ++sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Packaged MCP request timed out: ' + method));
      }, 15_000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  };
  const close = async () => {
    child.stdin.end();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let terminated = false;
    try {
      await Promise.race([
        closed,
        new Promise<void>((_resolve, reject) => {
          timer = setTimeout(() => {
            terminated = true;
            child.kill('SIGTERM');
          }, 5000);
          deadline = setTimeout(
            () => reject(new Error('Owned packaged MCP process did not stop.')),
            10_000,
          );
        }),
      ]);
      if (terminated)
        throw new Error('Owned packaged MCP process needed termination instead of EOF.');
    } finally {
      clearTimeout(timer);
      clearTimeout(deadline);
    }
  };
  return { request, close, pid: child.pid };
}

/** One bounded request to the owned application's authenticated local agent endpoint. */
export function requestAgent<T>(
  socketPath: string,
  token: string,
  request: Record<string, unknown>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    socket.setEncoding('utf8');
    let buffer = '';
    let settled = false;
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value!);
    };
    const timer = setTimeout(() => finish(new Error('Owned agent request timed out.')), 15_000);
    socket.on('error', (error) => finish(error));
    socket.on('close', () => {
      if (!settled) finish(new Error('Owned agent connection closed before its reply.'));
    });
    socket.on('connect', () => {
      socket.write(JSON.stringify({ id: 'native-acceptance', token, request }) + '\n');
    });
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 1024 * 1024)
        return finish(new Error('Owned agent reply exceeded its test limit.'));
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      try {
        const reply = JSON.parse(buffer.slice(0, newline)) as { error?: string; value: T };
        finish(reply.error ? new Error(reply.error) : undefined, reply.value);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}
