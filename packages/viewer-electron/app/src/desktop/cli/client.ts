import { PassThrough, Writable } from 'node:stream';
import { runMCPClient } from '../agents/mcp-client';
import { errorMessage } from '../../domain/errors';

export class CLIConnectionError extends Error {}
export class CLIServiceError extends Error {}
export type CLICall = (method: string, params: unknown, signal: AbortSignal) => Promise<unknown>;

/** Use the existing MCP transport in-process; tokens, socket framing and authority have one owner. */
export function cliClient(dataPath: string, token: string): CLICall {
  return async (method, params, signal) => {
    signal.throwIfAborted();
    const input = new PassThrough();
    const chunks: Buffer[] = [];
    const output = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    input.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\n');
    try {
      await runMCPClient(dataPath, { input, output, token, signal });
    } catch (error) {
      signal.throwIfAborted();
      throw new CLIConnectionError(errorMessage(error));
    } finally {
      input.destroy();
      output.destroy();
    }
    signal.throwIfAborted();
    let reply: { result?: unknown; error?: { message?: string } };
    try {
      reply = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new CLIConnectionError(
        'Viewer returned an incomplete response. Reconnect to the running app.',
      );
    }
    if (reply.error)
      throw new CLIServiceError(reply.error.message ?? 'Viewer rejected this request.');
    return reply.result;
  };
}

export function toolValue(result: unknown): unknown {
  if (!result || typeof result !== 'object' || !('content' in result)) return result;
  const value = result as { isError?: boolean; content?: { type: string; text?: string }[] };
  if (!Array.isArray(value.content))
    throw new CLIServiceError('Viewer returned an invalid tool response.');
  const text = value.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text ?? '')
    .join('\n');
  if (value.isError) throw new CLIServiceError(text || 'Viewer could not complete this tool.');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
