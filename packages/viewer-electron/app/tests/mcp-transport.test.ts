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
const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('node:net', () => ({ connect }));
import { runMCPClient } from '../src/desktop/agents/mcp-client';
import { replyLine } from '../src/desktop/agents/agent-broker';
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
      'approve agent access in Settings',
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
