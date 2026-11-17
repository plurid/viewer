import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import path from 'node:path';
import { remoteLimits } from '../../domain/remote/limits';
import { validateSocketPath } from '../../domain/remote/ssh-arguments';
import type { AskpassEnvironment } from './environment';
import { privateSocketFolder } from './socket-folder';

/**
 * `secret`: a password, passphrase, PIN or code, typed into a secure field. `host-key`: OpenSSH
 * asks whether to trust a key it has not seen. `confirm`: a yes or no question
 * (`SSH_ASKPASS_PROMPT=confirm`). `notice`: something to do elsewhere, such as touching a
 * security key (`SSH_ASKPASS_PROMPT=none`); OpenSSH ends it itself.
 */
export type RemotePromptKind = 'secret' | 'host-key' | 'confirm' | 'notice';

export interface RemotePrompt {
  connectionID: string;
  owner: number;
  title: string;
  text: string;
  kind: RemotePromptKind;
  /** Aborted by Disconnect, the attempt's expiry, a closed window, or OpenSSH ending the prompt. */
  signal: AbortSignal;
}

export type PromptAnswer = (prompt: RemotePrompt) => Promise<string | null>;

interface Attempt {
  id: string;
  name: string;
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
const invisible = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;
const hostKeyQuestion = /continue connecting|yes\/no|authenticity of host/i;

/**
 * Prompt text as people see it: line breaks and tabs become spaces, every other control, format,
 * bidi or invisible character is removed, and the result is capped at 2,000 characters.
 */
export function remotePromptText(text: string): string {
  const visible = [...text.slice(0, 4 * remoteLimits.serverPromptCharacters)]
    .map((character) => (/[\t\r\n\u2028\u2029]/u.test(character) ? ' ' : character))
    .filter((character) => !invisible.test(character))
    .join('')
    .replace(/ {2,}/g, ' ')
    .trim();
  return [...visible].slice(0, remoteLimits.serverPromptCharacters).join('');
}

function promptKind(hint: unknown, text: string): RemotePromptKind {
  if (hint === 'none') {
    return 'notice';
  }
  if (hint === 'confirm') {
    return 'confirm';
  }
  return hostKeyQuestion.test(text) ? 'host-key' : 'secret';
}

function abandoned(signal: AbortSignal): Promise<null> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(null);
    } else {
      signal.addEventListener('abort', () => resolve(null), { once: true });
    }
  });
}

/** Each token grants prompts for one clicked attempt and one window, never a connection forever. */
export class AskpassRelay {
  private server?: Server;
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
      const folder = await privateSocketFolder(
        'v-a-',
        'a',
        validateSocketPath,
        this.temporaryDirectory,
      );
      const socket = path.join(folder, 'a');
      validateSocketPath(socket);
      const server = createServer((client) => this.receive(client));
      this.server = server;
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(socket, () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      await chmod(socket, 0o600);
      if (this.closed) {
        server.close();
        throw new Error('Server prompts have closed.');
      }
      return socket;
    })();
    return this.socketPath;
  }

  async begin(id: string, name: string, owner: number): Promise<AskpassAttempt> {
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

  cancel(id: string): void {
    const attempt = this.attempts.get(id);
    if (!attempt) {
      return;
    }
    this.attempts.delete(id);
    clearTimeout(attempt.timer);
    attempt.controller.abort();
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
    const text = remotePromptText(request.prompt);
    const kind = promptKind(request.hint, text);
    // One question at a time per connection, in the order OpenSSH asked them.
    const task = attempt.tail.then(async () => {
      if (!live(attempt) || ended.aborted) {
        return null;
      }
      const signal = AbortSignal.any([attempt.controller.signal, ended]);
      const answer = await Promise.race([
        this.answer({
          connectionID: attempt.id,
          owner: attempt.owner,
          title: attempt.name + ' asks:',
          text: '“' + text + '”',
          kind,
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
    const server = this.server;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}
