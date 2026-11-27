import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import path from 'node:path';
import { remoteLimits } from '../../domain/remote/limits';
import { describePrompt } from '../../domain/remote/prompts';
import type { PromptPresentation } from '../../domain/remote/prompts';
import { validateSocketPath } from '../../domain/remote/ssh-arguments';
import type { AskpassEnvironment } from './environment';
import { privateSocketFolder, removeSocketFolder } from './socket-folder';

export type { RemotePromptKind } from '../../domain/remote/prompts';

export interface RemotePrompt extends PromptPresentation {
  connectionID: string;
  owner: number;
  /** Aborted by Disconnect, the attempt's expiry, a closed window, or OpenSSH ending the prompt. */
  signal: AbortSignal;
}

export type PromptAnswer = (prompt: RemotePrompt) => Promise<string | null>;

/** Ends a sign-in that OpenSSH asked a question Viewer never expects. */
export class UnexpectedQuestionError extends Error {
  readonly code = 'VIEWER_REMOTE_UNEXPECTED_QUESTION';

  constructor() {
    super(
      'OpenSSH asked to share this connection with another program. Viewer never shares one, so it stopped connecting. Connect again.',
    );
    this.name = 'UnexpectedQuestionError';
  }
}

interface Attempt {
  id: string;
  name: string;
  key?: string;
  owner: number;
  token: string;
  expires: number;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  tail: Promise<unknown>;
}

export interface AskpassAttempt {
  environment: AskpassEnvironment;
  signal: AbortSignal;
  cancel(): void;
}

/** A request line: the helper's JSON with a prompt of at most 8 KiB, escaped. */
const requestCharacters = 64 * 1024;
const answerCharacters = 64 * 1024;

function abandoned(signal: AbortSignal): Promise<null> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(null);
    } else {
      signal.addEventListener('abort', () => resolve(null), { once: true });
    }
  });
}

/**
 * Each token grants questions for one clicked attempt and one window, never a connection forever.
 * One token per attempt, not per question: OpenSSH starts every askpass of an attempt with the
 * same environment, so it cannot carry a new token for each. Node cannot see which process is at
 * the other end of a Unix socket, so there is no peer check either: the socket sits in a 0700
 * folder, the token is 256 random bits, and it expires with the attempt.
 */
export class AskpassRelay {
  private server?: Server;
  private folder?: string;
  private retiring?: Promise<void>;
  private socketPath?: Promise<string>;
  private attempts = new Map<string, Attempt>();
  private sockets = new Set<Socket>();
  private closed = false;

  constructor(
    private helper: string,
    private answer: PromptAnswer,
    private temporaryDirectory?: string,
  ) {}

  private listen(): Promise<string> {
    this.socketPath ??= (async () => {
      await this.retiring;
      if (this.closed) throw new Error('Server prompts have closed.');
      const folder = (this.folder ??= await privateSocketFolder(
        'v-a-',
        'a',
        validateSocketPath,
        this.temporaryDirectory,
      ));
      const socket = path.join(folder, 'a');
      validateSocketPath(socket);
      const server = createServer((client) => this.receive(client));
      this.server = server;
      let ready = false;
      let startupError: Error | undefined;
      const failed = (error: Error) => {
        if (this.server !== server) return;
        if (!ready) {
          startupError = error;
          return;
        }
        this.socketPath = undefined;
        this.server = undefined;
        for (const id of this.attempts.keys()) this.cancel(id, error);
        for (const client of this.sockets) client.destroy();
        this.retiring = new Promise<void>((resolve) => server.close(() => resolve()));
      };
      // Keep the error handler installed for the lifetime of this listener.
      server.on('error', failed);
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(socket, () => {
            server.removeListener('error', reject);
            resolve();
          });
        });
        await chmod(socket, 0o600);
        if (startupError) throw startupError;
        if (this.closed) throw new Error('Server prompts have closed.');
        ready = true;
        return socket;
      } catch (error) {
        this.server = undefined;
        await new Promise<void>((resolve) => server.close(() => resolve()));
        throw error;
      }
    })().catch((error) => {
      this.socketPath = undefined;
      throw error;
    });
    return this.socketPath;
  }

  /** `key` is the file name of the connection's chosen key, which OpenSSH may cut short. */
  async begin(id: string, name: string, owner: number, key?: string): Promise<AskpassAttempt> {
    if (this.closed) {
      throw new Error('Server prompts have closed.');
    }
    this.cancel(id);
    const socket = await this.listen();
    if (this.closed) {
      throw new Error('Server prompts have closed.');
    }
    this.cancel(id);
    const controller = new AbortController();
    const token = randomBytes(32).toString('hex');
    const timer = setTimeout(() => {
      if (this.attempts.get(id)?.token === token) {
        this.cancel(id);
      }
    }, remoteLimits.promptTimeoutMs).unref();
    const attempt: Attempt = {
      id,
      name,
      key,
      owner,
      token,
      controller,
      timer,
      expires: Date.now() + remoteLimits.promptTimeoutMs,
      tail: Promise.resolve(),
    };
    this.attempts.set(id, attempt);
    return {
      environment: { helper: this.helper, socket, token },
      signal: controller.signal,
      cancel: () => {
        if (this.attempts.get(id) === attempt) {
          this.cancel(id);
        }
      },
    };
  }

  cancel(id: string, reason?: Error): void {
    const attempt = this.attempts.get(id);
    if (!attempt) {
      return;
    }
    this.attempts.delete(id);
    clearTimeout(attempt.timer);
    attempt.controller.abort(reason);
  }

  cancelOwner(owner: number): void {
    for (const attempt of this.attempts.values()) {
      if (attempt.owner === owner) {
        this.cancel(attempt.id);
      }
    }
  }

  private receive(client: Socket): void {
    if (this.closed || this.sockets.size >= remoteLimits.promptSockets) {
      client.destroy();
      return;
    }
    // OpenSSH ends the helper when it stops waiting, as after a security key is touched.
    const ended = new AbortController();
    this.sockets.add(client);
    client.once('close', () => {
      this.sockets.delete(client);
      ended.abort();
    });
    client.on('error', () => {});
    client.setTimeout(remoteLimits.promptTimeoutMs, () => client.destroy());
    let input = '';
    const data = (bytes: Buffer) => {
      input += bytes.toString('utf8');
      if (input.length > requestCharacters) {
        client.destroy();
        return;
      }
      if (!input.includes('\n')) {
        return;
      }
      client.removeListener('data', data);
      void this.request(input.slice(0, input.indexOf('\n')), ended.signal).then(
        (answer) => {
          if (!client.destroyed) {
            client.end(JSON.stringify({ answer }) + '\n');
          }
        },
        () => {
          if (!client.destroyed) {
            client.end('{"answer":null}\n');
          }
        },
      );
    };
    client.on('data', data);
  }

  private find(token: string): Attempt | undefined {
    if (!/^[a-f0-9]{64}$/.test(token)) {
      return undefined;
    }
    const offered = Buffer.from(token, 'hex');
    return [...this.attempts.values()].find((item) =>
      timingSafeEqual(offered, Buffer.from(item.token, 'hex')),
    );
  }

  private async request(input: string, ended: AbortSignal): Promise<string | null> {
    let request: { token?: unknown; prompt?: unknown; hint?: unknown };
    try {
      request = JSON.parse(input);
    } catch {
      return null;
    }
    if (typeof request.token !== 'string' || typeof request.prompt !== 'string') {
      return null;
    }
    const attempt = this.find(request.token);
    const live = (item: Attempt) => !item.controller.signal.aborted && Date.now() < item.expires;
    if (!attempt || !live(attempt)) {
      return null;
    }
    if (request.hint === 'confirm') {
      // Only `ControlMaster ask` asks this, and Viewer's master never runs in that mode: answer
      // no without a sheet, and end the attempt.
      this.cancel(attempt.id, new UnexpectedQuestionError());
      return 'no';
    }
    const presentation = describePrompt(
      request.prompt,
      typeof request.hint === 'string' ? request.hint : undefined,
      { name: attempt.name, key: attempt.key },
    );
    // One question at a time per connection, in the order OpenSSH asked them.
    const task = attempt.tail.then(async () => {
      if (!live(attempt) || ended.aborted) {
        return null;
      }
      const signal = AbortSignal.any([attempt.controller.signal, ended]);
      const answer = await Promise.race([
        this.answer({
          ...presentation,
          connectionID: attempt.id,
          owner: attempt.owner,
          signal,
        }),
        abandoned(signal),
      ]);
      if (signal.aborted || !live(attempt)) {
        return null;
      }
      if (answer === null) {
        // The person chose Cancel: stop this sign-in, not only this question.
        this.cancel(attempt.id);
        return null;
      }
      if (answer.length > answerCharacters || /[\0\r\n]/.test(answer)) {
        return null;
      }
      return answer;
    });
    attempt.tail = task.catch(() => null);
    return task;
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const id of this.attempts.keys()) {
      this.cancel(id);
    }
    for (const socket of this.sockets) {
      socket.destroy();
    }
    await this.socketPath?.catch(() => undefined);
    await this.retiring;
    const server = this.server;
    if (server) {
      // Closing the listener unlinks its socket, which leaves the private folder empty.
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (this.folder) await removeSocketFolder(this.folder);
  }
}
