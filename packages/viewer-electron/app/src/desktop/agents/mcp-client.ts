import { connect } from 'node:net';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { AgentConnection, AgentConnectionFailure } from '../../domain/agents/clients';
import {
  agentConnectionAdvice,
  agentConnectionSchema,
  maxAgentReplyBytes,
} from '../../domain/agents/clients';
interface Transport {
  input: Readable;
  output: Writable;
  token?: string;
  signal?: AbortSignal;
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
  transport.signal?.throwIfAborted();
  if (!token) throw new Error('Set VIEWER_AGENT_TOKEN to the token shown in Viewer Settings.');
  const connectionFile = path.join(dataPath, 'agent-connection-v1.json');
  let connection: AgentConnection | undefined;
  try {
    const text = await readFile(connectionFile, 'utf8');
    connection = agentConnectionSchema.safeParse(JSON.parse(text)).data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError))
      throw error;
  }
  if (!connection)
    throw new Error(
      'Viewer’s agent connection is unavailable. Open Viewer and approve agent access in Settings → Agents.',
    );
  // a closed connection is never retried: its socket is gone or going
  if (connection.closed)
    throw await unreachable(
      connection,
      running(connection.pid) === false ? 'quit' : connection.closed,
    );
  const socket = connect(connection.socket);
  const abort = () => socket.destroy();
  transport.signal?.addEventListener('abort', abort, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
      socket.once('close', () => reject(new Error('Viewer disconnected while connecting.')));
      if (transport.signal?.aborted) socket.destroy();
    });
  } catch (error) {
    transport.signal?.removeEventListener('abort', abort);
    socket.destroy();
    const code = (error as NodeJS.ErrnoException).code;
    // a record left by an app that crashed, or a socket removed under a running one
    if (code === 'ENOENT' || code === 'ECONNREFUSED')
      throw await unreachable(connection, running(connection.pid) ? 'gone' : 'quit');
    throw error;
  }
  const input = createInterface({ input: transport.input });
  const pending = new Map<string, { id: unknown; timer: ReturnType<typeof setTimeout> }>();
  /** The reply line still arriving, and its length in bytes. */
  let parts: Buffer[] = [];
  let arriving = 0;
  let oversized = false;
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
        fail(
          request.id,
          oversized
            ? `Viewer sent a reply over ${maxAgentReplyBytes.toLocaleString('en-US')} bytes, ` +
                'more than this agent connection carries. Ask for less, then start the agent again.'
            : 'Viewer disconnected. Reconnect to the running app.',
        );
      }
      pending.clear();
      resolve();
    });
  });
  socket.on('error', () => {
    socket.destroy();
  });
  /** Forwards one reply line; false when it is not a reply, which ends the connection. */
  const forward = (line: string): boolean => {
    try {
      const reply = JSON.parse(line);
      const request = pending.get(reply.id);
      if (!request) return true;
      pending.delete(reply.id);
      clearTimeout(request.timer);
      if (reply.error) fail(request.id, String(reply.error));
      else write({ jsonrpc: '2.0', id: request.id, result: reply.value });
      return true;
    } catch {
      return false;
    }
  };
  // Lines are cut at newline bytes, which never occur inside a multi-byte UTF-8 character, and
  // counted as they arrive: the bound holds without rescanning a long line on every chunk.
  socket.on('data', (chunk: Buffer) => {
    let start = 0;
    for (let end = chunk.indexOf(10); ; end = chunk.indexOf(10, start)) {
      const piece = chunk.subarray(start, end < 0 ? chunk.length : end);
      arriving += piece.length;
      if (arriving > maxAgentReplyBytes) {
        // Viewer never sends this (`replyLine`); another version of it might
        oversized = true;
        socket.destroy();
        return;
      }
      parts.push(piece);
      if (end < 0) break;
      const line = Buffer.concat(parts).toString('utf8');
      parts = [];
      arriving = 0;
      if (!forward(line)) {
        socket.destroy();
        return;
      }
      start = end + 1;
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
  try {
    await completed;
    transport.signal?.throwIfAborted();
  } finally {
    transport.signal?.removeEventListener('abort', abort);
  }
}
/** Whether the process a connection record names still runs; unknown where Viewer cannot ask. */
function running(pid: number): boolean | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 1) return undefined;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? false : undefined;
  }
}
/** The app bundle a macOS executable is in. */
const bundle = (executable: string | undefined) =>
  executable ? /^(.+\.app)\/Contents\/MacOS\/[^/]+$/.exec(executable)?.[1] : undefined;
/** Why the agent cannot reach Viewer, and which Viewer to open: the one that last ran when it is
 * still there, otherwise this one, which the agent's configuration names. */
async function unreachable(
  connection: AgentConnection,
  failure: AgentConnectionFailure,
): Promise<Error> {
  const here = bundle(process.execPath);
  const last = bundle(connection.executable);
  const lastExists =
    !!last &&
    (await access(last).then(
      () => true,
      () => false,
    ));
  const app = lastExists ? last : here;
  return new Error(agentConnectionAdvice(failure, app, here && here !== app ? here : undefined));
}
