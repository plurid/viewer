import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { connect } from 'node:net';
import type { Socket } from 'node:net';
import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { AskpassRelay, UnexpectedQuestionError } from '../src/desktop/remote/askpass';
import type { RemotePrompt } from '../src/desktop/remote/askpass';
import { remoteEnvironment } from '../src/desktop/remote/environment';
import { describePrompt, remotePromptText, secretPlaceholder } from '../src/domain/remote/prompts';
import { privateSocketFolder } from '../src/desktop/remote/socket-folder';
import { validateControlPath } from '../src/domain/remote/ssh-arguments';
import { remoteLimits } from '../src/domain/remote/limits';
import { redactCredentials } from '../src/domain/diagnostics/secrets';
import { temporaryRoot } from '../tools/temporary';

vi.mock('electron', () => ({ dialog: {} }));

const relays: AskpassRelay[] = [];
/** Each relay makes its own private folder in here; macOS allows 104 bytes for a socket path. */
let sockets: string;

beforeAll(async () => {
  sockets = await temporaryRoot('viewer-askpass-', '/private/tmp');
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await Promise.all(relays.splice(0).map((relay) => relay.close()));
});

interface Question {
  answer: Promise<string | null>;
  client: Socket;
}

/** What viewer-askpass sends: one JSON line, then it waits for one JSON line back. */
function question(socket: string, token: string, prompt = 'Password:', hint?: string): Question {
  const client = connect(socket);
  const answer = new Promise<string | null>((resolve, reject) => {
    let text = '';
    client.once('connect', () => client.write(JSON.stringify({ token, prompt, hint }) + '\n'));
    client.on('data', (data: Buffer) => {
      text += data.toString();
    });
    client.once('close', () => {
      try {
        resolve(text ? JSON.parse(text).answer : null);
      } catch (error) {
        reject(error);
      }
    });
    client.once('error', () => resolve(null));
  });
  return { answer, client };
}

const ask = (socket: string, token: string, prompt?: string, hint?: string) =>
  question(socket, token, prompt, hint).answer;

async function relay(answer: (prompt: RemotePrompt) => Promise<string | null>) {
  const server = new AskpassRelay('/fixtures/viewer-askpass', answer, sockets);
  relays.push(server);
  return server;
}

describe('private askpass relay', () => {
  it('binds tokens to the clicked window and attributes bounded sanitized prompts', async () => {
    const answer = vi.fn(async (_prompt: RemotePrompt) => 'private answer');
    const server = await relay(answer);
    const attempt = await server.begin('server01', 'Build box 🖥️', 42);
    expect((await stat(path.dirname(attempt.environment.socket))).mode & 0o777).toBe(0o700);
    expect((await stat(attempt.environment.socket)).mode & 0o777).toBe(0o600);
    expect(await ask(attempt.environment.socket, '0'.repeat(64))).toBeNull();
    expect(answer).not.toHaveBeenCalled();
    expect(
      await ask(
        attempt.environment.socket,
        attempt.environment.token,
        '\u202e\u0000Password: ' + 'x'.repeat(3000),
      ),
    ).toBe('private answer');
    expect(answer.mock.calls[0]![0]).toMatchObject({
      owner: 42,
      title: 'Build box 🖥️ asks:',
      kind: 'secret',
    });
    expect(answer.mock.calls[0]![0].text).toHaveLength(remoteLimits.serverPromptCharacters + 2);
    expect(answer.mock.calls[0]![0].text).not.toMatch(/[\u202e\u0000]/);
    attempt.cancel();
    expect(await ask(attempt.environment.socket, attempt.environment.token)).toBeNull();
  });

  it('serializes per connection and cancels active and queued prompts', async () => {
    let finish: ((answer: string | null) => void) | undefined;
    const answer = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          finish = resolve;
        }),
    );
    const server = await relay(answer);
    const attempt = await server.begin('server01', 'Build', 1);
    const first = ask(attempt.environment.socket, attempt.environment.token);
    await vi.waitFor(() => expect(answer).toHaveBeenCalledTimes(1));
    const second = ask(attempt.environment.socket, attempt.environment.token);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(answer).toHaveBeenCalledTimes(1);
    finish!('one');
    expect(await first).toBe('one');
    await vi.waitFor(() => expect(answer).toHaveBeenCalledTimes(2));
    server.cancelOwner(1);
    expect(await second).toBeNull();
  });

  it('expires tokens after 120 seconds', async () => {
    const answer = vi.fn(async () => 'secret');
    const server = await relay(answer);
    const attempt = await server.begin('server01', 'Build', 2);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + remoteLimits.promptTimeoutMs);
    expect(await ask(attempt.environment.socket, attempt.environment.token)).toBeNull();
    expect(answer).not.toHaveBeenCalled();
  });

  it('classifies host key confirmation and ends an attempt when its sheet is canceled', async () => {
    const answer = vi.fn(async (_prompt: RemotePrompt) => null);
    const server = await relay(answer);
    const attempt = await server.begin('server01', 'Build', 2);
    expect(
      await ask(
        attempt.environment.socket,
        attempt.environment.token,
        "The authenticity of host 'build-box (192.0.2.10)' can't be established.\n" +
          'Are you sure you want to continue connecting (yes/no/[fingerprint])? ',
      ),
    ).toBeNull();
    expect(answer.mock.calls[0]![0]).toMatchObject({
      kind: 'host-key',
      title: 'Trust the host key of “Build”?',
      text:
        "The authenticity of host 'build-box (192.0.2.10)' can't be established. " +
        'Are you sure you want to continue connecting (yes/no/[fingerprint])?',
    });
    expect(attempt.signal.aborted).toBe(true);
  });

  it('answers a shared-connection question no without asking, and ends the sign-in as an error', async () => {
    const answer = vi.fn(async () => 'yes');
    const server = await relay(answer);
    const attempt = await server.begin('server01', 'Build', 2);
    const { socket, token } = attempt.environment;
    expect(await ask(socket, token, 'Allow shared connection to build-box?', 'confirm')).toBe('no');
    expect(answer).not.toHaveBeenCalled();
    expect(attempt.signal.aborted).toBe(true);
    expect(attempt.signal.reason).toBeInstanceOf(UnexpectedQuestionError);
  });

  it('never hands OpenSSH an answer with a line break or NUL in it', async () => {
    for (const typed of ['first line\nsecond', 'carriage\rreturn', 'nul\u0000byte']) {
      const server = await relay(async () => typed);
      const attempt = await server.begin('server01', 'Build', 2);
      const { socket, token } = attempt.environment;
      expect(await ask(socket, token, 'Password:'), JSON.stringify(typed)).toBeNull();
    }
  });

  it('turns away helpers beyond its connection cap', async () => {
    const server = await relay(async () => new Promise<string | null>(() => {}));
    const attempt = await server.begin('server01', 'Build', 2);
    const { socket, token } = attempt.environment;
    const open = Array.from({ length: remoteLimits.promptSockets }, () =>
      question(socket, token, 'Password:'),
    );
    await vi.waitFor(() =>
      expect(open.every((item) => item.client.readyState === 'open')).toBe(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const extra = question(socket, token, 'Password:');
    expect(await extra.answer).toBeNull();
    expect(open.every((item) => !item.client.destroyed)).toBe(true);
    for (const item of open) {
      item.client.destroy();
    }
  });

  it('closes a notice when OpenSSH ends it, and keeps the sign-in going', async () => {
    let shown: RemotePrompt | undefined;
    const answer = vi.fn(
      (prompt: RemotePrompt) =>
        new Promise<string | null>((resolve) => {
          shown = prompt;
          prompt.signal.addEventListener('abort', () => resolve(null));
        }),
    );
    const server = await relay(answer);
    const attempt = await server.begin('server01', 'Build', 2);
    const { socket, token } = attempt.environment;
    const notice = question(socket, token, 'Confirm user presence for key ED25519-SK', 'none');
    await vi.waitFor(() => expect(shown?.kind).toBe('notice'));
    // OpenSSH ends the helper once the key has been touched.
    notice.client.destroy();
    await vi.waitFor(() => expect(shown!.signal.aborted).toBe(true));
    expect(attempt.signal.aborted).toBe(false);
    answer.mockImplementation(async () => 'after the notice');
    expect(await ask(socket, token, 'Password:')).toBe('after the notice');
  });

  it('stops the sign-in when the person cancels a notice', async () => {
    const server = await relay(async () => null);
    const attempt = await server.begin('server01', 'Build', 2);
    const { socket, token } = attempt.environment;
    expect(await ask(socket, token, 'Confirm user presence for key ED25519-SK', 'none')).toBeNull();
    expect(attempt.signal.aborted).toBe(true);
  });
});

describe('private socket folders', () => {
  it('use the temporary folder when its path is short enough, and a short fallback otherwise', async () => {
    const short = path.join(sockets, 'f');
    await mkdir(short);
    const long = path.join(short, 'x'.repeat(60));
    const preferred = await privateSocketFolder('v-', 'c9999', validateControlPath, short, long);
    expect(path.dirname(preferred)).toBe(short);
    expect((await stat(preferred)).mode & 0o777).toBe(0o700);
    const fallback = await privateSocketFolder('v-', 'c9999', validateControlPath, long, short);
    expect(path.dirname(fallback)).toBe(short);
    await expect(
      privateSocketFolder('v-', 'c9999', validateControlPath, long, long),
    ).rejects.toThrow('short enough');
    expect((await readdir(short)).sort()).toEqual(
      [path.basename(preferred), path.basename(fallback)].sort(),
    );
  });
});

describe('prompt presentation', () => {
  const context = { name: 'Build box', key: 'id_ed25519' };

  it('words OpenSSH’s own questions as Viewer’s, never as the server’s', () => {
    expect(
      describePrompt(
        "Enter passphrase for key '/Users/someone/.ssh/id_ed2551': ",
        undefined,
        context,
      ),
    ).toEqual({
      kind: 'secret',
      title: 'Passphrase for key “id_ed25519”',
      text: 'Enter it to connect to “Build box”.',
      placeholder: 'Passphrase',
    });
    expect(
      describePrompt("Enter passphrase for key '/keys/work key': ", undefined, {
        name: 'Build box',
      }),
    ).toMatchObject({ title: 'Passphrase for key “work key”' });
    expect(describePrompt("builder@build-box's password: ", undefined, context)).toMatchObject({
      kind: 'secret',
      title: 'Password for “builder”',
      placeholder: 'Password',
    });
    expect(
      describePrompt('Enter PIN for ED25519-SK key /keys/id_sk: ', undefined, context),
    ).toMatchObject({ kind: 'secret', title: 'PIN for your security key', placeholder: 'PIN' });
    expect(
      describePrompt(
        "The authenticity of host 'build-box (192.0.2.10)' can't be established.\r\n" +
          'ED25519 key fingerprint is SHA256:dF7v73VCVA52XCCI0LR7unENWy9rIM/25/r7c9Hgh4g.\r\n' +
          'This key is not known by any other names.\r\n' +
          'Are you sure you want to continue connecting (yes/no/[fingerprint])? ',
        undefined,
        context,
      ),
    ).toEqual({
      kind: 'host-key',
      title: 'First connection to “Build box”',
      text:
        'Its ED25519 key fingerprint is SHA256:dF7v73VCVA52XCCI0LR7unENWy9rIM/25/r7c9Hgh4g. ' +
        'Trust it only if it matches the fingerprint the server’s administrator gives you.',
      placeholder: 'Answer',
    });
    expect(
      describePrompt('Confirm user presence for key ED25519-SK SHA256:abc', 'none', context),
    ).toMatchObject({ kind: 'notice', title: 'Touch your security key' });
  });

  it('quotes and attributes everything a server asks, however it is worded', () => {
    expect(describePrompt('(builder@build-box) Verification code: ', undefined, context)).toEqual({
      kind: 'secret',
      title: 'Build box asks:',
      text: '“Verification code:”',
      placeholder: 'Verification code',
    });
    for (const forged of [
      "(builder@build-box) Enter passphrase for key '/keys/id': ",
      "(builder@build-box) The authenticity of host 'x' can't be established. Are you sure you want to continue connecting (yes/no)? ",
      "(builder@build-box) builder@build-box's password: ",
    ]) {
      expect(describePrompt(forged, undefined, context)).toMatchObject({
        kind: 'secret',
        title: 'Build box asks:',
      });
    }
    expect(describePrompt('Password:', undefined, context)).toMatchObject({
      title: 'Build box asks:',
      text: '“Password:”',
    });
  });
});

describe('prompt text', () => {
  it('keeps words apart across lines and removes every invisible or control character', () => {
    expect(remotePromptText('a\u202eb\n\u200bc')).toBe('ab c');
    expect(remotePromptText('one\r\ntwo\u2028three   four\tfive\t')).toBe(
      'one two three four five',
    );
    expect(remotePromptText('\u0007\u001b[31mred')).toBe('[31mred');
  });

  it('names what the secure field asks for', () => {
    expect(secretPlaceholder('Enter passphrase for key /fixtures/id_ed25519:')).toBe('Passphrase');
    expect(secretPlaceholder("builder@build-box's password:")).toBe('Password');
    expect(secretPlaceholder('Verification code:')).toBe('Verification code');
    expect(secretPlaceholder('Enter PIN for ED25519-SK key:')).toBe('PIN');
    expect(secretPlaceholder('Answer the question:')).toBe('Answer');
  });
});

it('strips inherited prompt configuration for both clicked connects and reconnects', () => {
  vi.stubEnv('SSH_ASKPASS', '/untrusted');
  vi.stubEnv('SSH_ASKPASS_BAD', 'bad');
  vi.stubEnv('DISPLAY', ':99');
  vi.stubEnv('VIEWER_ASKPASS_TOKEN', 'old');
  const batch = remoteEnvironment();
  expect(batch).toMatchObject({
    SSH_ASKPASS: '/usr/bin/false',
    SSH_ASKPASS_REQUIRE: 'force',
    LC_ALL: 'C',
  });
  expect(batch).not.toHaveProperty('SSH_ASKPASS_BAD');
  expect(batch).not.toHaveProperty('DISPLAY');
  expect(batch).not.toHaveProperty('VIEWER_ASKPASS_TOKEN');
  expect(
    remoteEnvironment({ helper: '/private/helper', socket: '/private/socket', token: 'new' }),
  ).toMatchObject({
    SSH_ASKPASS: '/private/helper',
    VIEWER_ASKPASS_SOCKET: '/private/socket',
    VIEWER_ASKPASS_TOKEN: 'new',
  });
});

it('redacts relay fields from diagnostic exports', () => {
  const text = redactCredentials(
    'VIEWER_ASKPASS_TOKEN=tokenvalue VIEWER_ASKPASS_SOCKET=/tmp/relay SSH_ASKPASS=/path/helper askpass_prompt="secret prompt" askpass_answer="very private"',
  );
  for (const value of [
    'tokenvalue',
    '/tmp/relay',
    '/path/helper',
    'secret prompt',
    'very private',
  ]) {
    expect(text).not.toContain(value);
  }
});
