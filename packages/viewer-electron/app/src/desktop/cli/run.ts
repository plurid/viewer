import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { cliExit } from '../../domain/cli/catalog';
import { parseCLI, CLIUsageError, type CLIInvocation } from '../../domain/cli/arguments';
import { cliCompletion, cliHelp } from '../../domain/cli/help';
import { cliClient, CLIConnectionError, CLIServiceError, toolValue, type CLICall } from './client';
import { errorMessage } from '../../domain/errors';

export interface CLIEnvironment {
  dataPath: string;
  version: string;
  cwd: string;
  home: string;
  token?: string;
  input: Readable;
  output: Writable;
  error: Writable;
  signal?: AbortSignal;
  call?: CLICall;
}
const write = (stream: Writable, text: string) =>
  new Promise<void>((resolve, reject) =>
    stream.write(text, (error) => (error ? reject(error) : resolve())),
  );
const terminalText = (value: string) =>
  value.replace(
    /[\u0000-\u0008\u000b-\u001f\u007f\u009b]/g,
    (char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'),
  );

async function inputJSON(input: Readable, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  const chunks: Buffer[] = [];
  let bytes = 0;
  const abort = () => input.destroy(new Error('Input cancelled.'));
  signal.addEventListener('abort', abort, { once: true });
  try {
    for await (const chunk of input) {
      signal.throwIfAborted();
      const buffer = Buffer.from(chunk);
      if ((bytes += buffer.length) > 65536) throw new CLIUsageError('JSON stdin exceeds 64 KiB.');
      chunks.push(buffer);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new CLIUsageError('Stdin must contain one JSON value.');
    }
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
function callParameters(invocation: CLIInvocation): {
  name: string;
  arguments: Record<string, unknown>;
} {
  const command = invocation.command!;
  const parameters = { ...invocation.parameters, ...command.fixed };
  if (command.name.join(' ') === 'tools call') {
    const { tool, args } = parameters;
    if (!args || typeof args !== 'object' || Array.isArray(args))
      throw new CLIUsageError('--args must be a JSON object.');
    return { name: String(tool), arguments: args as Record<string, unknown> };
  }
  return { name: command.tool!, arguments: parameters };
}
function operationID(value: unknown): string | undefined {
  return value && typeof value === 'object' && 'id' in value && typeof value.id === 'string'
    ? value.id
    : undefined;
}
async function waitFor(
  invocation: CLIInvocation,
  initial: unknown,
  call: CLICall,
  signal: AbortSignal,
): Promise<unknown> {
  const id = operationID(initial),
    tool = invocation.command?.poll;
  if (!id || !tool || !invocation.wait) return initial;
  while (true) {
    const current = toolValue(await call('tools/call', { name: tool, arguments: { id } }, signal));
    const status =
      current && typeof current === 'object' && 'status' in current
        ? String(current.status)
        : undefined;
    if (['failed', 'rejected', 'cancelled'].includes(status ?? ''))
      throw new CLIServiceError(
        current && typeof current === 'object' && 'error' in current && current.error
          ? String(current.error)
          : 'The operation was ' + status + '.',
      );
    if (
      ['completed', 'waiting-review', 'paused'].includes(status ?? '') ||
      (tool === 'get_task' && status === 'review')
    )
      return current;
    if (!status) throw new CLIServiceError('Viewer returned an operation without a status.');
    await delay(300, undefined, { signal });
  }
}

/** Headless CLI results never share stdout with diagnostics or imply that a review was approved. */
export async function runCLI(
  args: readonly string[],
  environment: CLIEnvironment,
): Promise<number> {
  let invocation: CLIInvocation | undefined;
  let activeID: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const abort = () => controller.abort(environment.signal?.reason);
  environment.signal?.addEventListener('abort', abort, { once: true });
  if (environment.signal?.aborted) abort();
  try {
    invocation = parseCLI(args, (file) =>
      path.resolve(
        environment.cwd,
        file === '~'
          ? environment.home
          : file.startsWith('~/')
            ? path.join(environment.home, file.slice(2))
            : file,
      ),
    );
    const json = invocation.json;
    let result: unknown;
    if (invocation.kind === 'version') result = { version: environment.version };
    else if (invocation.kind === 'help') result = cliHelp(invocation.topic);
    else if (invocation.kind === 'completion') result = cliCompletion(invocation.topic[0]!);
    else {
      timer = setTimeout(
        () => controller.abort(new Error('CLI deadline exceeded.')),
        invocation.timeout,
      );
      if (invocation.stdin)
        invocation.parameters[invocation.stdin] = await inputJSON(
          environment.input,
          controller.signal,
        );
      if (!environment.token && !environment.call) {
        await write(
          environment.error,
          'Set VIEWER_AGENT_TOKEN to a named client token from Settings → Agents. Grant only the folders and capabilities needed.\n',
        );
        if (json)
          await write(
            environment.output,
            JSON.stringify({
              ok: false,
              error: {
                code: 'CREDENTIALS_REQUIRED',
                message: 'A scoped Viewer client token is required.',
              },
            }) + '\n',
          );
        return cliExit.credentials;
      }
      const call = environment.call ?? cliClient(environment.dataPath, environment.token!);
      const name = invocation.command!.name.join(' ');
      if (name === 'status') result = await call('ping', undefined, controller.signal);
      else if (name === 'tools list')
        result = await call('tools/list', undefined, controller.signal);
      else
        result = toolValue(await call('tools/call', callParameters(invocation), controller.signal));
      activeID = operationID(result);
      if (activeID && invocation.wait && !json)
        await write(
          environment.error,
          'Operation ' + terminalText(activeID) + ' — waiting; review remains in Viewer.\n',
        );
      result = await waitFor(invocation, result, call, controller.signal);
    }
    if (json)
      await write(
        environment.output,
        JSON.stringify({
          ok: true,
          command: invocation.topic.join(' ') || invocation.kind,
          result,
        }) + '\n',
      );
    else
      await write(
        environment.output,
        typeof result === 'string'
          ? terminalText(result) + (result.endsWith('\n') ? '' : '\n')
          : JSON.stringify(result, null, 2) + '\n',
      );
    return cliExit.success;
  } catch (error) {
    const cancelled = environment.signal?.aborted;
    const code = cancelled
      ? cliExit.cancelled
      : controller.signal.aborted
        ? cliExit.timeout
        : error instanceof CLIUsageError
          ? cliExit.usage
          : error instanceof CLIConnectionError
            ? cliExit.connection
            : cliExit.failed;
    const message = cancelled
      ? 'CLI request cancelled. Use the operation ID to inspect or cancel work already submitted.'
      : controller.signal.aborted
        ? 'CLI deadline exceeded. The operation may still be running; inspect its ID before retrying.'
        : errorMessage(error);
    const json = invocation?.json ?? args.includes('--json');
    if (json)
      await write(
        environment.output,
        JSON.stringify({
          ok: false,
          error: { code, message },
          ...(activeID ? { operationID: activeID } : {}),
        }) + '\n',
      );
    else
      await write(
        environment.error,
        terminalText(message) + (activeID ? '\nOperation: ' + terminalText(activeID) : '') + '\n',
      );
    return code;
  } finally {
    if (timer) clearTimeout(timer);
    environment.signal?.removeEventListener('abort', abort);
  }
}
