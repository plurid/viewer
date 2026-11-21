import { describe, it, expect, vi } from 'vitest';
import { Duplex, PassThrough } from 'node:stream';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import type { AgentConnection } from '../src/domain/agents/clients';
import {
  agentConnectionAdvice,
  maxAgentReadBytes,
  maxAgentReplyBytes,
} from '../src/domain/agents/clients';
const { connect, createServer } = vi.hoisted(() => ({
  connect: vi.fn(),
  createServer: vi.fn(),
}));
vi.mock('node:net', () => ({ connect, createServer }));
import { runMCPClient } from '../src/desktop/agents/mcp-client';
import { AgentBroker, replyLine } from '../src/desktop/agents/agent-broker';
import { defaultSettings } from '../src/domain/services';
import type { FileServices } from '../src/desktop/files/file-services';
import type { ActionPlanner } from '../src/desktop/actions/planner';
import type { AgentRequests } from '../src/desktop/agents/agent-requests';
import type { SettingsService } from '../src/desktop/preferences/settings';
import { EventEmitter } from 'node:events';
import type { Server, Socket } from 'node:net';
const record = '{"socket":"fixture","pid":1}';
/** A socket that answers each request with `reply(id)`, split into `pieces` chunks. */
const replying = (reply: (id: string) => Buffer, pieces = 1) =>
  new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      const line = reply(JSON.parse(String(chunk)).id);
      const step = Math.ceil(line.length / pieces);
      for (let start = 0; start < line.length; start += step)
        this.push(line.subarray(start, start + step));
      callback();
    },
    final(callback) {
      this.push(null);
      callback();
    },
  });
/** One request through the relay to `socket`; the relay's reply to it. */
async function relay(root: string, socket: Duplex) {
  connect.mockImplementation(() => {
    queueMicrotask(() => socket.emit('connect'));
    return socket;
  });
  const input = new PassThrough(),
    output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(chunk));
  input.end('{"jsonrpc":"2.0","id":4,"method":"tools/call"}\n');
  await runMCPClient(root, { input, output, token: 'fixture-token' });
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
it('explains the native setup gate when no broker connection has been approved', async () => {
  const root = await temporaryRoot('viewer-mcp-unapproved-');
  const input = new PassThrough();
  const output = new PassThrough();
  try {
    await expect(runMCPClient(root, { input, output, token: 'fixture-token' })).rejects.toThrow(
      'allow agent access in Settings',
    );
  } finally {
    input.destroy();
    output.destroy();
    await trashTemporary(root);
  }
});
it('drains pending replies after stdio EOF and preserves split Unicode', async () => {
  const root = await temporaryRoot('viewer-mcp-transport-');
  try {
    await writeFile(path.join(root, 'agent-connection-v1.json'), record);
    const socket = new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        const request = JSON.parse(String(chunk));
        expect(request.token).toBe('fixture-token');
        setTimeout(() => {
          const reply = Buffer.from(JSON.stringify({ id: request.id, value: 'Résumé' }) + '\n');
          const split = reply.indexOf(Buffer.from('é')) + 1;
          this.push(reply.subarray(0, split));
          this.push(reply.subarray(split));
          callback();
        }, 5);
      },
      final(callback) {
        this.push(null);
        callback();
      },
    });
    connect.mockImplementation(() => {
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    });
    const input = new PassThrough(),
      output = new PassThrough();
    let text = '';
    output.on('data', (chunk) => {
      text += chunk;
    });
    input.end('{"jsonrpc":"2.0","id":4,"method":"tools/list"}\n');
    await runMCPClient(root, { input, output, token: 'fixture-token' });
    expect(JSON.parse(text)).toEqual({ jsonrpc: '2.0', id: 4, result: 'Résumé' });
  } finally {
    await trashTemporary(root);
  }
});
it('returns an explicit error for pending calls when the app disconnects', async () => {
  const root = await temporaryRoot('viewer-mcp-disconnect-');
  try {
    await writeFile(path.join(root, 'agent-connection-v1.json'), record);
    const socket = new Duplex({
      read() {},
      write(_chunk, _encoding, callback) {
        queueMicrotask(() => this.destroy());
        callback();
      },
    });
    connect.mockImplementation(() => {
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    });
    const input = new PassThrough(),
      output = new PassThrough();
    let text = '';
    output.on('data', (chunk) => {
      text += chunk;
    });
    input.write('{"jsonrpc":"2.0","id":5,"method":"tools/list"}\n');
    await runMCPClient(root, { input, output, token: 'fixture-token' });
    input.end();
    expect(JSON.parse(text).error.message).toContain('disconnected');
  } finally {
    await trashTemporary(root);
  }
});
it('aborts a pending transport request and closes its owned socket', async () => {
  const root = await temporaryRoot('viewer-mcp-abort-');
  const input = new PassThrough(),
    output = new PassThrough();
  try {
    await writeFile(path.join(root, 'agent-connection-v1.json'), record);
    const controller = new AbortController();
    const socket = new Duplex({
      read() {},
      write(_chunk, _encoding, callback) {
        callback();
        queueMicrotask(() => controller.abort(new Error('Generated cancellation.')));
      },
    });
    connect.mockImplementation(() => {
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    });
    input.end('{"jsonrpc":"2.0","id":5,"method":"tools/list"}\n');
    await expect(
      runMCPClient(root, { input, output, token: 'fixture-token', signal: controller.signal }),
    ).rejects.toThrow('Generated cancellation');
    expect(socket.destroyed).toBe(true);
  } finally {
    input.destroy();
    output.destroy();
    await trashTemporary(root);
  }
});
describe('replies at the relay bound (2026-10-30)', () => {
  // A reply over 8,000,000 bytes closed the connection, while a client's budget went to 64 MiB.
  it('carries a result at the largest budget, escaped at worst, and a line at the bound', async () => {
    const root = await temporaryRoot('viewer-mcp-bound-');
    try {
      await writeFile(path.join(root, 'agent-connection-v1.json'), record);
      // every backslash in the result's JSON text is escaped once more on the way
      const value = '\\'.repeat((maxAgentReadBytes - 2) / 2);
      const text = JSON.stringify(value);
      expect(Buffer.byteLength(text)).toBe(maxAgentReadBytes);
      const result = { content: [{ type: 'text', text }] };
      const line = replyLine('1', result);
      expect(Buffer.byteLength(line) - 1).toBeLessThanOrEqual(maxAgentReplyBytes);
      expect(
        (
          await relay(
            root,
            replying(() => Buffer.from(line), 300),
          )
        ).result,
      ).toEqual(result);
      const prefix = '{"id":"1","value":"';
      const exact = prefix + 'a'.repeat(maxAgentReplyBytes - prefix.length - 2) + '"}';
      expect(Buffer.byteLength(exact)).toBe(maxAgentReplyBytes);
      const reply = await relay(
        root,
        replying(() => Buffer.from(exact + '\n'), 40),
      );
      expect(reply.result).toHaveLength(maxAgentReplyBytes - prefix.length - 2);
    } finally {
      await trashTemporary(root);
    }
  });
  it('answers a longer reply with an error the agent can act on', async () => {
    const root = await temporaryRoot('viewer-mcp-bound-');
    try {
      await writeFile(path.join(root, 'agent-connection-v1.json'), record);
      const long = replyLine('1', 'a'.repeat(maxAgentReplyBytes));
      expect(JSON.parse(long)).toEqual({
        id: '1',
        error: expect.stringContaining('Ask for a smaller range, fewer files or a summary.'),
      });
      expect(
        (
          await relay(
            root,
            replying(() => Buffer.from(long)),
          )
        ).error.message,
      ).toContain('one reply to an agent may take');
      // only another version of Viewer could send it; the relay still names the bound
      const over = '{"id":"1","value":"' + 'a'.repeat(maxAgentReplyBytes) + '"}\n';
      expect(
        (
          await relay(
            root,
            replying(() => Buffer.from(over), 40),
          )
        ).error.message,
      ).toBe(
        `Viewer sent a reply over ${maxAgentReplyBytes.toLocaleString('en-US')} bytes, more than ` +
          'this agent connection carries. Ask for less, then start the agent again.',
      );
    } finally {
      await trashTemporary(root);
    }
  });
});
describe('an agent started while Viewer is closed (2026-10-30)', () => {
  // The connection record outlived the socket, and the agent got `connect ENOENT …/v.sock`.
  const failing = (code: string) => {
    const socket = new Duplex({ read() {}, write: (_chunk, _encoding, callback) => callback() });
    connect.mockImplementation(() => {
      queueMicrotask(() =>
        socket.emit('error', Object.assign(new Error('connect ' + code), { code })),
      );
      return socket;
    });
  };
  const start = (root: string) =>
    runMCPClient(root, { input: new PassThrough(), output: new PassThrough(), token: 'token' });
  // a process number no process has: macOS assigns them below 100,000
  const gone = 99_999;
  it('says which Viewer to open, why it cannot connect, and never names the socket', async () => {
    const root = await temporaryRoot('viewer-mcp-closed-');
    try {
      const executable = path.join(root, 'Viewer.app', 'Contents', 'MacOS', 'Viewer');
      await mkdir(path.dirname(executable), { recursive: true });
      await writeFile(executable, '');
      const save = (connection: AgentConnection) =>
        writeFile(path.join(root, 'agent-connection-v1.json'), JSON.stringify(connection));
      const open = { socket: path.join(root, 'v.sock'), executable };
      const app = path.join(root, 'Viewer.app');
      await save({ ...open, pid: process.pid, closed: 'quit' });
      await expect(start(root)).rejects.toThrow(
        `Viewer is not running. Open Viewer (${app}), then start the agent again.`,
      );
      await save({ ...open, pid: process.pid, closed: 'off' });
      await expect(start(root)).rejects.toThrow(
        'Agent access is off in Viewer. Turn on Allow local agent clients in Settings → Agents',
      );
      // marked off, then the app ended without quitting
      await save({ ...open, pid: gone, closed: 'off' });
      await expect(start(root)).rejects.toThrow('Viewer is not running.');
      await save({ ...open, pid: gone });
      failing('ECONNREFUSED');
      await expect(start(root)).rejects.toThrow(`Open Viewer (${app})`);
      await save({ ...open, pid: process.pid });
      failing('ENOENT');
      await expect(start(root)).rejects.toThrow(
        'Viewer is running, but its agent connection has closed. Quit and reopen Viewer',
      );
      await save({ ...open, pid: gone, executable: path.join(root, 'Moved.app/Contents/MacOS/V') });
      failing('ENOENT');
      await expect(start(root)).rejects.toThrow(
        /^Viewer is not running\. Open Viewer, then start the agent again\.$/,
      );
      failing('EACCES');
      await expect(start(root)).rejects.toThrow('connect EACCES');
    } finally {
      await trashTemporary(root);
    }
  });
  it('names the copy the agent starts when it is not the one that last ran', () => {
    expect(
      agentConnectionAdvice('quit', '/Applications/Viewer.app', '/Users/me/Downloads/Viewer.app'),
    ).toBe(
      'Viewer is not running. Open Viewer (/Applications/Viewer.app), then start the agent ' +
        'again. This agent starts another copy, at /Users/me/Downloads/Viewer.app.',
    );
  });
});

function duplexPair() {
  const clientSide: Duplex = new Duplex({
    allowHalfOpen: false,
    read() {},
    write(chunk, _encoding, callback) {
      serverSide.push(Buffer.from(chunk));
      callback();
    },
    final(callback) {
      serverSide.push(null);
      callback();
    },
  });
  const serverSide: Duplex = new Duplex({
    allowHalfOpen: false,
    read() {},
    write(chunk, _encoding, callback) {
      clientSide.push(Buffer.from(chunk));
      callback();
    },
    final(callback) {
      clientSide.push(null);
      callback();
    },
  });
  clientSide.on('close', () => {
    if (!serverSide.destroyed) serverSide.destroy();
  });
  serverSide.on('close', () => {
    if (!clientSide.destroyed) clientSide.destroy();
  });
  return { client: clientSide, server: serverSide };
}

function mockBrokerServer() {
  let onConnection: ((stream: Socket) => void) | undefined;
  createServer.mockImplementation((listener: (stream: Socket) => void) => {
    onConnection = listener;
    const server = Object.assign(new EventEmitter(), {
      listening: false,
      listen(socket: string, callback?: () => void) {
        server.listening = true;
        void writeFile(socket, '').then(() => callback?.());
        return server;
      },
      close(callback?: () => void) {
        server.listening = false;
        callback?.();
        return server;
      },
    });
    return server as unknown as Server;
  });
  return (stream: Duplex) => onConnection!(stream as unknown as Socket);
}

async function approveBrokerAccess(broker: AgentBroker, folder: string) {
  const change = { enabled: true, add: [folder] };
  const review = await broker.access.captureReview(change);
  await broker.access.approve(change, review);
}

describe('broker request cancellation, framing and credential isolation', () => {
  it('cancels timed-out in-flight reads and skips queued proposals across the relay', async () => {
    const root = await temporaryRoot('viewer-mcp-timeout-');
    const dataPath = path.join(root, 'Data');
    const folder = path.join(root, 'Granted');
    await mkdir(dataPath);
    await mkdir(folder);
    const file = path.join(folder, 'Scan.pdf');
    await writeFile(file, '%PDF-1.4\n');
    const accept = mockBrokerServer();
    let inspectSignal: AbortSignal | undefined;
    let releaseInspect!: () => void;
    const inspectStarted = new Promise<void>((resolve) => {
      releaseInspect = resolve;
    });
    let finishInspect!: () => void;
    const inspect = vi.fn(
      (_file: string, _content?: boolean, _ocr?: boolean, signal?: AbortSignal) => {
        inspectSignal = signal;
        releaseInspect();
        return new Promise((resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason ?? new Error('Aborted.')), {
            once: true,
          });
          finishInspect = () => resolve({ path: file, summary: 'Done' });
        });
      },
    );
    const transform = vi.fn(() => ({ id: 'proposal-should-not-exist', status: 'review' }));
    const settings = defaultSettings(root);
    settings.agents.enabled = true;
    settings.agents.roots = [folder];
    const broker = new AgentBroker(
      dataPath,
      () => settings,
      () => undefined,
      { inspect } as unknown as FileServices,
      { all: async () => [], cancel: () => {} } as unknown as ActionPlanner,
      {
        catalog: () => ({
          target: {
            workspaceID: 'ws',
            rootID: 'root',
            paneID: 'pane',
            directory: folder,
            selection: [],
          },
          commands: [],
        }),
        requests: {
          transform,
          stop: () => {},
          revokeGrants: async () => {},
          has: () => false,
          cancel: () => {},
        } as unknown as AgentRequests,
        config: {} as unknown as SettingsService,
      },
    );
    await approveBrokerAccess(broker, folder);
    const created = await broker.clients.create({
      name: 'TimeoutClient',
      roots: [folder],
      capabilities: ['metadata', 'content', 'propose'],
      budgets: { maxReadBytes: 1048576, maxTasks: 4 },
    });
    await broker.start();
    const pair = duplexPair();
    connect.mockImplementation(() => {
      accept(pair.server);
      queueMicrotask(() => pair.client.emit('connect'));
      return pair.client;
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const input = new PassThrough();
    const output = new PassThrough();
    const replies: Record<string, unknown>[] = [];
    let outBuffer = '';
    output.on('data', (chunk: Buffer) => {
      outBuffer += chunk.toString('utf8');
      for (let index = outBuffer.indexOf('\n'); index >= 0; index = outBuffer.indexOf('\n')) {
        replies.push(JSON.parse(outBuffer.slice(0, index)));
        outBuffer = outBuffer.slice(index + 1);
      }
    });
    try {
      const running = runMCPClient(dataPath, { input, output, token: created.token });
      input.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'inspect_file', arguments: { path: file, ocr: true } },
        }) + '\n',
      );
      input.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'propose_transform',
            arguments: {
              sources: [file],
              destination: folder,
              name: 'out.webp',
              plan: { kind: 'image', format: 'webp' },
            },
          },
        }) + '\n',
      );
      await inspectStarted;
      await vi.advanceTimersByTimeAsync(120_000);
      expect(replies).toHaveLength(2);
      expect(
        replies.every((item) =>
          String((item.error as { message?: string })?.message).includes('timed out'),
        ),
      ).toBe(true);
      expect(inspectSignal?.aborted).toBe(true);
      finishInspect();
      await new Promise((resolve) => setImmediate(resolve));
      expect(transform).not.toHaveBeenCalled();
      input.end();
      await running;
    } finally {
      vi.useRealTimers();
      await broker.close();
      await trashTemporary(root);
    }
  });

  it('keeps reading cancel frames during a 17-request burst timeout so queued proposals never execute', async () => {
    const root = await temporaryRoot('viewer-mcp-burst-timeout-');
    const dataPath = path.join(root, 'Data');
    const folder = path.join(root, 'Granted');
    await mkdir(dataPath);
    await mkdir(folder);
    const file = path.join(folder, 'Scan.pdf');
    await writeFile(file, '%PDF-1.4\n');
    const accept = mockBrokerServer();
    let inspectSignal: AbortSignal | undefined;
    let releaseStarted!: () => void;
    const inspectStarted = new Promise<void>((resolve) => {
      releaseStarted = resolve;
    });
    let finishInspect!: () => void;
    const inspect = vi.fn(
      (_file: string, _content?: boolean, _ocr?: boolean, signal?: AbortSignal) => {
        inspectSignal = signal;
        releaseStarted();
        return new Promise((resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason ?? new Error('Aborted.')), {
            once: true,
          });
          finishInspect = () => resolve({ path: file, summary: 'Done' });
        });
      },
    );
    const configuration = vi.fn(() => ({ id: 'config-should-not-run', requiresUserReview: true }));
    const settings = defaultSettings(root);
    settings.agents.enabled = true;
    settings.agents.roots = [folder];
    const broker = new AgentBroker(
      dataPath,
      () => settings,
      () => undefined,
      { inspect } as unknown as FileServices,
      { all: async () => [], cancel: () => {} } as unknown as ActionPlanner,
      {
        catalog: () => ({
          target: {
            workspaceID: 'ws',
            rootID: 'root',
            paneID: 'pane',
            directory: folder,
            selection: [],
          },
          commands: [],
        }),
        requests: {
          configuration,
          stop: () => {},
          revokeGrants: async () => {},
          has: () => false,
          cancel: () => {},
        } as unknown as AgentRequests,
        config: {} as unknown as SettingsService,
      },
    );
    await approveBrokerAccess(broker, folder);
    const created = await broker.clients.create({
      name: 'BurstTimeoutClient',
      roots: [folder],
      capabilities: ['metadata', 'content', 'propose'],
      budgets: { maxReadBytes: 1048576, maxTasks: 4 },
    });
    await broker.start();
    const pair = duplexPair();
    connect.mockImplementation(() => {
      accept(pair.server);
      queueMicrotask(() => pair.client.emit('connect'));
      return pair.client;
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const input = new PassThrough();
    const output = new PassThrough();
    const replies: Record<string, unknown>[] = [];
    let outBuffer = '';
    output.on('data', (chunk: Buffer) => {
      outBuffer += chunk.toString('utf8');
      for (let index = outBuffer.indexOf('\n'); index >= 0; index = outBuffer.indexOf('\n')) {
        replies.push(JSON.parse(outBuffer.slice(0, index)));
        outBuffer = outBuffer.slice(index + 1);
      }
    });
    try {
      const running = runMCPClient(dataPath, { input, output, token: created.token });
      input.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'inspect_file', arguments: { path: file, ocr: true } },
        }) + '\n',
      );
      input.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'propose_config',
            arguments: { patches: [{ path: 'settings.appearance', value: 'light' }] },
          },
        }) + '\n',
      );
      for (let id = 3; id <= 16; id++)
        input.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' }) + '\n');
      await inspectStarted;
      input.write(JSON.stringify({ jsonrpc: '2.0', id: 17, method: 'ping' }) + '\n');
      await vi.advanceTimersByTimeAsync(120_000);
      expect(replies).toHaveLength(17);
      expect(inspectSignal?.aborted).toBe(true);
      finishInspect();
      await new Promise((resolve) => setImmediate(resolve));
      expect(configuration).not.toHaveBeenCalled();
      input.end();
      await running;
    } finally {
      vi.useRealTimers();
      await broker.close();
      await trashTemporary(root);
    }
  });

  it('preserves request id on oversized lines and frames near-65536 and batched lines cleanly', async () => {
    const root = await temporaryRoot('viewer-mcp-framing-');
    const dataPath = path.join(root, 'Data');
    const folder = path.join(root, 'Granted');
    await mkdir(dataPath);
    await mkdir(folder);
    const accept = mockBrokerServer();
    const settings = defaultSettings(root);
    settings.agents.enabled = true;
    settings.agents.roots = [folder];
    const broker = new AgentBroker(
      dataPath,
      () => settings,
      () => undefined,
      {} as unknown as FileServices,
      { all: async () => [], cancel: () => {} } as unknown as ActionPlanner,
    );
    await approveBrokerAccess(broker, folder);
    const token = await broker.credential();
    await broker.start();
    const pair = duplexPair();
    connect.mockImplementation(() => {
      accept(pair.server);
      queueMicrotask(() => pair.client.emit('connect'));
      return pair.client;
    });
    const input = new PassThrough();
    const output = new PassThrough();
    const replies: Record<string, unknown>[] = [];
    let outBuffer = '';
    output.on('data', (chunk: Buffer) => {
      outBuffer += chunk.toString('utf8');
      for (let index = outBuffer.indexOf('\n'); index >= 0; index = outBuffer.indexOf('\n')) {
        replies.push(JSON.parse(outBuffer.slice(0, index)));
        outBuffer = outBuffer.slice(index + 1);
      }
    });
    try {
      const running = runMCPClient(dataPath, { input, output, token });
      // 1. Oversized line (> 65,536 bytes) must answer -32600 with its actual id.
      const tooBig = JSON.stringify({
        jsonrpc: '2.0',
        id: 'req-oversized',
        method: 'ping',
        params: { pad: 'a'.repeat(70_000) },
      });
      expect(Buffer.byteLength(tooBig)).toBeGreaterThan(65536);
      // 2. Near-limit line (65,500 bytes) must pass through relay+broker without dropping socket.
      const prefix = '{"jsonrpc":"2.0","id":"req-near","method":"ping","params":{"pad":"';
      const suffix = '"}}';
      const nearLimit = prefix + 'b'.repeat(65500 - prefix.length - suffix.length) + suffix;
      expect(Buffer.byteLength(nearLimit)).toBe(65500);
      // 3. Two 40 KB lines delivered in one write must both succeed without tripping a buffer cap.
      const batchOne = JSON.stringify({
        jsonrpc: '2.0',
        id: 'req-batch-1',
        method: 'ping',
        params: { pad: 'c'.repeat(40_000) },
      });
      const batchTwo = JSON.stringify({
        jsonrpc: '2.0',
        id: 'req-batch-2',
        method: 'ping',
        params: { pad: 'd'.repeat(40_000) },
      });
      input.write(`${tooBig}\n${nearLimit}\n${batchOne}\n${batchTwo}\n`);
      input.end();
      await running;
      expect(replies).toEqual([
        {
          jsonrpc: '2.0',
          id: 'req-oversized',
          error: { code: -32600, message: 'Request exceeded its size limit.' },
        },
        { jsonrpc: '2.0', id: 'req-near', result: {} },
        { jsonrpc: '2.0', id: 'req-batch-1', result: {} },
        { jsonrpc: '2.0', id: 'req-batch-2', result: {} },
      ]);
    } finally {
      await broker.close();
      await trashTemporary(root);
    }
  });

  it('disconnects only shared-token streams when rotating the shared credential', async () => {
    const root = await temporaryRoot('viewer-mcp-rotate-');
    const dataPath = path.join(root, 'Data');
    const folder = path.join(root, 'Granted');
    await mkdir(dataPath);
    await mkdir(folder);
    const accept = mockBrokerServer();
    const settings = defaultSettings(root);
    settings.agents.enabled = true;
    settings.agents.roots = [folder];
    const broker = new AgentBroker(
      dataPath,
      () => settings,
      () => undefined,
      {} as unknown as FileServices,
      { all: async () => [], cancel: () => {} } as unknown as ActionPlanner,
    );
    await approveBrokerAccess(broker, folder);
    const sharedToken = await broker.credential();
    const named = await broker.clients.create({
      name: 'NamedKeepOpen',
      roots: [folder],
      capabilities: ['metadata'],
      budgets: { maxReadBytes: 1048576, maxTasks: 4 },
    });
    await broker.start();
    const sharedPair = duplexPair();
    const namedPair = duplexPair();
    accept(sharedPair.server);
    accept(namedPair.server);
    const askOnce = (client: Duplex, line: string) =>
      new Promise<Record<string, unknown>>((resolve) => {
        let buf = '';
        const onData = (chunk: Buffer) => {
          buf += chunk.toString('utf8');
          const nl = buf.indexOf('\n');
          if (nl >= 0) {
            client.off('data', onData);
            resolve(JSON.parse(buf.slice(0, nl)));
          }
        };
        client.on('data', onData);
        client.write(line + '\n');
      });
    try {
      expect(
        await askOnce(
          sharedPair.client,
          JSON.stringify({ id: '1', token: sharedToken, request: { method: 'ping' } }),
        ),
      ).toEqual({ id: '1', value: {} });
      expect(
        await askOnce(
          namedPair.client,
          JSON.stringify({ id: '2', token: named.token, request: { method: 'ping' } }),
        ),
      ).toEqual({ id: '2', value: {} });
      await broker.credential();
      expect(sharedPair.server.destroyed).toBe(true);
      expect(namedPair.server.destroyed).toBe(false);
      expect(
        await askOnce(
          namedPair.client,
          JSON.stringify({ id: '3', token: named.token, request: { method: 'ping' } }),
        ),
      ).toEqual({ id: '3', value: {} });
    } finally {
      sharedPair.client.destroy();
      namedPair.client.destroy();
      await broker.close();
      await trashTemporary(root);
    }
  });
});
