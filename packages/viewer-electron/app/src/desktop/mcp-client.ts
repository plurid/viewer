import { connect } from 'node:net';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { StringDecoder } from 'node:string_decoder';
import type { Readable, Writable } from 'node:stream';
interface Transport {
  input: Readable;
  output: Writable;
  token?: string;
}
/** Headless stdio client; the running UI application owns services and approval. */
export async function runMCPClient(
  dataPath: string,
  transport: Transport = {
    input: process.stdin,
    output: process.stdout,
    token: process.env.VIEWER_AGENT_TOKEN,
  },
): Promise<void> {
  const token = transport.token;
  if (!token) throw new Error('Set VIEWER_AGENT_TOKEN to the token shown in Viewer Settings.');
  const connection = JSON.parse(
    await readFile(path.join(dataPath, 'agent-connection-v1.json'), 'utf8'),
  ) as { socket: string };
  const socket = connect(connection.socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  const input = createInterface({ input: transport.input });
  const pending = new Map<string, { id: unknown; timer: ReturnType<typeof setTimeout> }>();
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let sequence = 0;
  let ended = false;
  const write = (value: unknown) => transport.output.write(JSON.stringify(value) + '\n');
  const fail = (id: unknown, message: string, code = -32603) =>
    write({ jsonrpc: '2.0', id, error: { code, message } });
  const drained = () => {
    if (ended && !pending.size) socket.end();
  };
  const completed = new Promise<void>((resolve) => {
    socket.once('close', () => {
      input.close();
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        fail(request.id, 'Viewer disconnected. Reconnect to the running app.');
      }
      pending.clear();
      resolve();
    });
  });
  socket.on('error', () => {
    socket.destroy();
  });
  socket.on('data', (chunk) => {
    buffer += decoder.write(chunk);
    if (Buffer.byteLength(buffer) > 8000000) {
      socket.destroy();
      return;
    }
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        const reply = JSON.parse(line);
        const request = pending.get(reply.id);
        if (!request) continue;
        pending.delete(reply.id);
        clearTimeout(request.timer);
        if (reply.error) fail(request.id, String(reply.error));
        else write({ jsonrpc: '2.0', id: request.id, result: reply.value });
      } catch {
        socket.destroy();
        return;
      }
    }
    drained();
  });
  input.on('line', (line) => {
    if (Buffer.byteLength(line) > 65536) {
      fail(null, 'Request exceeded its size limit.', -32600);
      return;
    }
    try {
      const request = JSON.parse(line);
      if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
        fail(request?.id ?? null, 'Invalid request.', -32600);
        return;
      }
      if (request.id === undefined) return;
      if (pending.size >= 100) {
        fail(request.id, 'Too many pending requests.');
        return;
      }
      const id = String(++sequence);
      const timer = setTimeout(() => {
        pending.delete(id);
        fail(request.id, 'Viewer request timed out.');
        drained();
      }, 120000);
      pending.set(id, { id: request.id, timer });
      socket.write(JSON.stringify({ id, token, request }) + '\n');
    } catch {
      fail(null, 'Invalid JSON.', -32700);
    }
  });
  // EOF waits for submitted requests; closing stdin must not lose their responses.
  input.on('close', () => {
    ended = true;
    drained();
  });
  await completed;
}
