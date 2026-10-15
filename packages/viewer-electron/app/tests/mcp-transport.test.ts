import { it, expect, vi } from 'vitest';
import { Duplex, PassThrough } from 'node:stream';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('node:net', () => ({ connect }));
import { runMCPClient } from '../src/desktop/mcp-client';
it('drains pending replies after stdio EOF and preserves split Unicode', async () => {
  const root = await temporaryRoot('viewer-mcp-transport-');
  try {
    await writeFile(path.join(root, 'agent-connection-v1.json'), '{"socket":"fixture"}');
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
    await writeFile(path.join(root, 'agent-connection-v1.json'), '{"socket":"fixture"}');
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
