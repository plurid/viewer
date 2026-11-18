import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import path from 'node:path';
import { RemoteConnections } from '../src/desktop/remote/connections';
import type { RemoteCaller } from '../src/desktop/remote/connections';
import { remoteConnection } from '../src/domain/remote/connections';
import { createRemoteHandlers } from '../src/desktop/ipc/remote-handlers';
import type { RemoteSessionPort } from '../src/desktop/remote/session';
import type { SSHRunner, SSHRunOptions } from '../src/desktop/remote/control';
import type { RemotePrompt } from '../src/desktop/remote/askpass';
import { buildFakeSSH, fakeSSHExecutable } from './support/remote-transport';
import type { FakeSSHFixture } from './support/remote-transport';
import { changedKeyStderr, fixtureFingerprint } from './support/ssh-error-samples';
import { temporaryRoot } from '../tools/temporary';
import { remoteLimits } from '../src/domain/remote/limits';

vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() } }));

type Options = ConstructorParameters<typeof RemoteConnections>[0];
type StubSessions = { [Key in keyof RemoteSessionPort]: Mock<RemoteSessionPort[Key]> };
type SSHKind = 'master' | 'check' | 'exit';

const caller: RemoteCaller = { owner: 7, role: 'settings', agentDriven: false };
const base = remoteConnection.parse({ id: 'server01', name: 'Build box', host: 'build-box' });
let fixture: FakeSSHFixture;
/** Each service makes its own private folders in here; macOS allows 104 bytes for a socket path. */
let sockets: string;
const services: RemoteConnections[] = [];

beforeAll(async () => {
  fixture = await buildFakeSSH();
  sockets = await temporaryRoot('viewer-sockets-', '/private/tmp');
}, 30000);

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(services.splice(0).map((service) => service.close()));
  vi.unstubAllEnvs();
});

async function service(extra: Partial<Options> = {}) {
  vi.stubEnv('VIEWER_REMOTE', '1');
  const root = await temporaryRoot('viewer-connections-');
  const bin = await temporaryRoot('viewer-ssh-bin-');
  const log = path.join(bin, 'ssh.jsonl');
  const event = vi.fn();
  const prompt = vi.fn(async (_prompt: RemotePrompt): Promise<string | null> => 'test answer');
  const remote = new RemoteConnections({
    dataPath: root,
    worker: fixture.worker,
    helper: '/fixtures/viewer-askpass',
    prompt,
    event,
    backend: 'thread',
    sshExecutable: await fakeSSHExecutable(fixture, bin, log),
    temporaryDirectory: sockets,
    ...extra,
  });
  services.push(remote);
  return { remote, root, bin, log, event, prompt };
}

async function save(remote: RemoteConnections, patch: Partial<typeof base> = {}) {
  await remote.request({ type: 'save', connection: { ...base, ...patch } }, caller);
}

async function logs(file: string) {
  return (await readFile(file, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

function stubSessions(
  request: RemoteSessionPort['request'] = async () => ({ type: 'path', path: '/' }),
): StubSessions {
  return {
    configure: vi.fn(async () => {}),
    request: vi.fn(request),
    release: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}

const kindOf = (args: string[]): SSHKind =>
  args.includes('-O') ? (args[args.indexOf('-O') + 1] as SSHKind) : 'master';

/** A runner standing in for ssh: each kind answers with the exit code and stderr the test sets. */
function stubRunner(
  codes: Partial<Record<SSHKind, number>> = {},
  stderr: Partial<Record<SSHKind, string>> = {},
) {
  const runner = vi.fn<SSHRunner>(async (command) => {
    const kind = kindOf(command.args);
    return {
      code: codes[kind] ?? 0,
      stderr: stderr[kind] ?? 'ssh: connect to host build-box port 22: Connection refused\r\n',
    };
  });
  const calls = (kind: SSHKind) =>
    runner.mock.calls.map(([command]) => command).filter((item) => kindOf(item.args) === kind);
  return { runner, codes, stderr, calls };
}

/** What viewer-askpass does: one JSON line to the relay, one JSON line back. */
function askRelay(options: SSHRunOptions, prompt: string, hint?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const client = connect(options.environment.VIEWER_ASKPASS_SOCKET!);
    let text = '';
    client.once('connect', () =>
      client.write(
        JSON.stringify({ token: options.environment.VIEWER_ASKPASS_TOKEN, prompt, hint }) + '\n',
      ),
    );
    client.on('data', (data: Buffer) => {
      text += data.toString();
    });
    client.once('close', () => resolve(text ? JSON.parse(text).answer : null));
    client.once('error', () => resolve(null));
  });
}

describe('saved server authority', () => {
  it('does not write or connect at launch or list, saves privately only from Settings', async () => {
    const { remote, root, log } = await service();
    expect(await readdir(root)).toEqual([]);
    await remote.request({ type: 'list' }, caller);
    expect(await readdir(root)).toEqual([]);
    await expect(
      remote.request({ type: 'save', connection: base }, { ...caller, role: 'viewer' }),
    ).rejects.toThrow('Settings');
    await save(remote);
    const file = path.join(root, 'remote-connections-v1.json');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, 'utf8')).connections[0]).toEqual(base);
    await expect(stat(log)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves an unreadable record before a new save', async () => {
    const { remote, root } = await service();
    await writeFile(path.join(root, 'remote-connections-v1.json'), '{incomplete');
    expect((await remote.request({ type: 'list' }, caller)).connections).toEqual([]);
    const preserved = (await readdir(root)).find((name) => name.includes('.unreadable-'))!;
    expect(await readFile(path.join(root, preserved), 'utf8')).toBe('{incomplete');
    await save(remote);
    expect(await readFile(path.join(root, preserved), 'utf8')).toBe('{incomplete');
  });

  it('refuses agents, agent-driven windows and disabled builds before reading storage', async () => {
    const { remote, root } = await service();
    for (const actor of [
      { ...caller, role: 'agent' as const },
      { ...caller, agentDriven: true },
    ]) {
      await expect(remote.request({ type: 'list' }, actor)).rejects.toMatchObject({
        code: 'VIEWER_REMOTE_AGENT_REFUSED',
      });
    }
    const handlers = createRemoteHandlers({ remote, caller: () => undefined });
    await expect(handlers.remote([{ type: 'list' }], 10)).rejects.toThrow('only to the person');
    vi.stubEnv('VIEWER_REMOTE', '0');
    await expect(remote.request({ type: 'list' }, caller)).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_DISABLED',
    });
    expect(await readdir(root)).toEqual([]);
  });

  it('keeps a connection through a new name or consent, and reconnects for each endpoint field', async () => {
    const { runner, calls } = stubRunner();
    const { remote, bin } = await service({ runner, sessions: stubSessions() });
    const key = path.join(bin, 'id_ed25519');
    await writeFile(key, 'not read', { mode: 0o600 });
    await save(remote);
    await remote.connect(base.id, caller.owner);
    await save(remote, { name: 'Renamed box', startPath: '/srv' });
    await remote.request({ type: 'ssh-config-hosts', id: base.id, consent: false }, caller);
    expect(remote.snapshot()[0]).toMatchObject({
      state: 'ready',
      connection: { name: 'Renamed box', sshConfig: 'declined' },
    });
    expect(calls('exit')).toHaveLength(0);
    const changes: Partial<typeof base>[] = [
      { port: 2222 },
      { port: 2222, identityFile: key },
      { port: 2222, identityFile: key, jump: ['first'] },
      { port: 2222, identityFile: key, jump: ['first'], user: 'builder' },
      { port: 2222, identityFile: key, jump: ['first'], user: 'builder', host: 'other-box' },
    ];
    for (const [index, change] of changes.entries()) {
      await save(remote, { name: 'Renamed box', ...change });
      expect(remote.snapshot()[0]).toMatchObject({ state: 'saved', connection: change });
      expect(calls('exit')).toHaveLength(index + 1);
      await remote.connect(base.id, caller.owner);
      expect(remote.snapshot()[0]!.state).toBe('ready');
    }
  });
});

describe('fake ssh and SFTP connection lifecycle', () => {
  it('connects, serves primitives through the worker and quiesces before exit', async () => {
    vi.stubEnv('DISPLAY', ':99');
    vi.stubEnv('VIEWER_TEST_LEAK', 'from Viewer');
    const quiesce = vi.fn(async () => {});
    const { remote, log, event } = await service({ quiesce });
    await save(remote, { user: 'builder', port: 2222 });
    const result = await remote.request({ type: 'connect', id: base.id }, caller);
    expect(result.connections[0]).toMatchObject({ state: 'ready', home: '/home' });
    expect(event.mock.calls.map(([items]) => items[0]?.state)).toContain('connecting');
    const listing = await remote.perform(base.id, 'browse', { type: 'list', path: '/' });
    expect(listing.type).toBe('list');
    if (listing.type === 'list') {
      expect(listing.entries).toContainEqual(
        expect.objectContaining({ kind: 'entry', name: 'hello.txt' }),
      );
    }
    const read = await remote.perform(base.id, 'browse', {
      type: 'read',
      path: '/hello.txt',
      offset: 0n,
      length: 5,
    });
    expect(read.type === 'read' && Buffer.from(read.bytes).toString()).toBe('hello');
    expect(await remote.perform(base.id, 'walk', { type: 'realpath', path: '/hello.txt' })).toEqual(
      { type: 'path', path: '/hello.txt' },
    );
    expect(
      await remote.perform(base.id, 'transfer', {
        type: 'write',
        path: '/new.txt',
        bytes: Buffer.from('new'),
      }),
    ).toEqual({ type: 'write', bytes: 3n });
    const info = await remote.perform(base.id, 'browse', { type: 'stat', path: '/hello.txt' });
    expect(info.type === 'stat' && info.attributes.size).toBe(24n);
    await expect(
      remote.perform(base.id, 'browse', { type: 'stat', path: '/missing' }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await remote.disconnect(base.id);
    expect(quiesce).toHaveBeenCalledWith(base.id);
    await expect(
      remote.perform(base.id, 'browse', { type: 'list', path: '/' }),
    ).rejects.toMatchObject({ code: 'VIEWER_REMOTE_DISCONNECTED' });
    const commands = await logs(log);
    const master = commands.find((item) => item.command === 'master');
    expect(master).toMatchObject({ controlMaster: 'yes' });
    expect(master.args).not.toContain('-M');
    expect(master.args).toEqual(expect.arrayContaining(['-l', 'builder', '-p', '2222']));
    const channels = commands.filter((item) => item.command === 'sftp');
    expect(channels).toHaveLength(3);
    for (const command of channels) {
      expect(command).toMatchObject({
        batch: true,
        askpass: '/usr/bin/false',
        tokenPresent: false,
      });
      // A channel never signs in by itself: no endpoint, and a ProxyCommand that fails.
      expect(command.args).toContain('ProxyCommand=/usr/bin/false');
      expect(command.args).not.toEqual(expect.arrayContaining(['-l']));
      expect(command.args).not.toEqual(expect.arrayContaining(['-p']));
    }
    for (const command of commands) {
      expect(command.environment ?? []).not.toContain('DISPLAY');
      expect(command.environment ?? []).not.toContain('VIEWER_TEST_LEAK');
    }
    expect(commands.some((item) => item.command === 'direct-sign-in')).toBe(false);
    expect(commands.at(-1).command).toBe('exit');
  });

  it('answers the relay without logging its answer or token', async () => {
    const { remote, log, prompt } = await service();
    await save(remote, { host: 'prompt-box' });
    await remote.connect(base.id, caller.owner);
    expect(remote.snapshot()[0]!.state).toBe('ready');
    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({ owner: caller.owner, title: 'Build box asks:', kind: 'secret' }),
    );
    // The fake ssh logs the names in its environment, never a value: no answer, no token.
    expect(await readFile(log, 'utf8')).not.toMatch(/test answer|[a-f0-9]{64}/);
  });

  it.each([
    ['changed-box', 'host-key-changed'],
    ['auth-box', 'needs-sign-in'],
    ['unreachable-box', 'unreachable'],
  ])('classifies %s', async (host, state) => {
    const { remote } = await service();
    await save(remote, { host });
    await remote.connect(base.id, caller.owner);
    expect(remote.snapshot()[0]!.state).toBe(state);
  });

  it('shows the fingerprint a changed server offered, then forgets it once connected', async () => {
    const { remote, log } = await service();
    await save(remote);
    await writeFile(log + '.mode', JSON.stringify({ failure: changedKeyStderr }));
    await remote.connect(base.id, caller.owner);
    expect(remote.snapshot()[0]).toMatchObject({
      state: 'host-key-changed',
      hostKey: { type: 'ED25519', fingerprint: fixtureFingerprint },
    });
    await writeFile(log + '.mode', JSON.stringify({}));
    await remote.connect(base.id, caller.owner);
    expect(remote.snapshot()[0]!.state).toBe('ready');
    expect(remote.snapshot()[0]!.hostKey).toBeUndefined();
  });

  it('cancels an unanswered prompt on Disconnect', async () => {
    const prompt = vi.fn((_prompt: RemotePrompt) => new Promise<string | null>(() => {}));
    const { remote } = await service({ prompt });
    await save(remote, { host: 'prompt-box' });
    const connecting = remote.connect(base.id, caller.owner);
    await vi.waitFor(() => expect(prompt).toHaveBeenCalled());
    await remote.disconnect(base.id);
    await connecting;
    expect(prompt.mock.calls[0]![0].signal.aborted).toBe(true);
    expect(remote.snapshot()[0]!.state).toBe('disconnected');
  });

  it('withdraws a shown question at once on Disconnect, before ssh has ended', async () => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    // This ssh ignores cancellation until told, as one stuck in a slow network call would.
    const runner = vi.fn<SSHRunner>(async (command, options) => {
      if (kindOf(command.args) !== 'master') {
        return { code: 0, stderr: '' };
      }
      await askRelay(options, 'Password:');
      await finished;
      return { code: 255, stderr: '' };
    });
    const prompt = vi.fn((_prompt: RemotePrompt) => new Promise<string | null>(() => {}));
    const { remote } = await service({ runner, sessions: stubSessions(), prompt });
    await save(remote);
    const connecting = remote.connect(base.id, caller.owner).catch(() => {});
    await vi.waitFor(() => expect(prompt).toHaveBeenCalled());
    const disconnecting = remote.disconnect(base.id);
    await vi.waitFor(() => expect(prompt.mock.calls[0]![0].signal.aborted).toBe(true));
    finish();
    await Promise.all([connecting, disconnecting]);
    expect(remote.snapshot()[0]!.state).toBe('disconnected');
  });

  it('cancels an unanswered prompt when its window closes', async () => {
    const prompt = vi.fn((_prompt: RemotePrompt) => new Promise<string | null>(() => {}));
    const { remote } = await service({ prompt });
    await save(remote, { host: 'prompt-box' });
    const connecting = remote.connect(base.id, caller.owner);
    await vi.waitFor(() => expect(prompt).toHaveBeenCalled());
    remote.ownerClosed(caller.owner + 1);
    expect(prompt.mock.calls[0]![0].signal.aborted).toBe(false);
    remote.ownerClosed(caller.owner);
    await connecting;
    expect(prompt.mock.calls[0]![0].signal.aborted).toBe(true);
    expect(remote.snapshot()[0]!.state).toBe('disconnected');
  });

  it('reopens idle channels through the same master without signing in again', async () => {
    // The master is a stand-in so fake time never cuts a real process short; channels are real.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { runner, calls } = stubRunner();
    const { remote, log } = await service({ runner });
    // What the fake ssh would have recorded had it started the master itself.
    runner.mockImplementation(async (command) => {
      if (kindOf(command.args) === 'master') {
        const socket = command.args[command.args.indexOf('-S') + 1]!;
        await writeFile(log + '.masters', JSON.stringify({ [socket]: 'running' }));
      }
      return { code: 0, stderr: '' };
    });
    await save(remote);
    await remote.connect(base.id, caller.owner);
    await vi.advanceTimersByTimeAsync(remoteLimits.idleBrowseMs);
    expect(remote.snapshot()[0]!.state).toBe('ready');
    const listing = await remote.perform(base.id, 'browse', { type: 'list', path: '/' });
    expect(listing.type).toBe('list');
    expect((await logs(log)).filter((item) => item.command === 'sftp')).toHaveLength(2);
    expect(calls('master')).toHaveLength(1);
    expect(calls('check').length).toBeGreaterThan(0);
    expect(calls('exit')).toHaveLength(0);
  });

  it('replaces a lost channel through a master that still answers, without a new sign-in', async () => {
    const { remote, log } = await service();
    await save(remote);
    await remote.connect(base.id, caller.owner);
    // New channels now fail at once; the master still answers -O check.
    await writeFile(log + '.mode', JSON.stringify({ failure: 'subsystem request failed\n' }));
    await expect(
      remote.perform(base.id, 'walk', { type: 'list', path: '/' }),
    ).rejects.toBeDefined();
    await vi.waitFor(async () =>
      expect((await logs(log)).filter((item) => item.command === 'check').length).toBeGreaterThan(
        1,
      ),
    );
    await writeFile(log + '.mode', JSON.stringify({}));
    const listing = await remote.perform(base.id, 'walk', { type: 'list', path: '/' });
    expect(listing.type).toBe('list');
    expect(remote.snapshot()[0]!.state).toBe('ready');
    const commands = await logs(log);
    expect(commands.filter((item) => item.command === 'master')).toHaveLength(1);
    expect(commands.filter((item) => item.command === 'exit')).toHaveLength(0);
  });

  it('never lets a channel sign in by itself after its master is gone', async () => {
    const { remote, log, prompt } = await service();
    await save(remote);
    await remote.connect(base.id, caller.owner);
    await writeFile(
      log + '.mode',
      JSON.stringify({
        checkDrop: true,
        failure: 'ssh: connect to host build-box port 22: Connection refused\n',
      }),
    );
    await remote.perform(base.id, 'walk', { type: 'list', path: '/' }).catch(() => {});
    await vi.waitFor(() => expect(remote.snapshot()[0]!.state).toBe('unreachable'), {
      timeout: 5000,
    });
    await remote.disconnect(base.id);
    const commands = await logs(log);
    expect(commands.some((item) => item.command === 'direct-sign-in')).toBe(false);
    const masters = commands.filter((item) => item.command === 'master');
    expect(masters).toHaveLength(2);
    expect(masters[1]).toMatchObject({ batch: true, askpass: '/usr/bin/false' });
    expect(prompt).not.toHaveBeenCalled();
  });

  it('treats an ssh -f that made no control socket as unreachable', async () => {
    const { remote, log } = await service();
    await save(remote);
    await writeFile(log + '.mode', JSON.stringify({ noSocket: true }));
    await remote.connect(base.id, caller.owner);
    expect(remote.snapshot()[0]!.state).toBe('unreachable');
    expect((await logs(log)).some((item) => item.command === 'sftp')).toBe(false);
  });

  it('quits inside the two-second master budget, leaving no master running', async () => {
    const { remote, log } = await service();
    await save(remote);
    await remote.connect(base.id, caller.owner);
    const start = performance.now();
    await remote.close();
    expect(performance.now() - start).toBeLessThan(remoteLimits.quitTimeoutMs);
    expect((await logs(log)).at(-1).command).toBe('exit');
    expect(Object.values(JSON.parse(await readFile(log + '.masters', 'utf8')))).toEqual(['gone']);
  });
});

describe('ending masters', () => {
  it('signals a master that refused -O exit only after the socket names the same process', async () => {
    const terminate = vi.fn();
    const { runner, codes, stderr } = stubRunner(
      {},
      { check: 'Master running (pid=4242)\r\n', exit: 'Exit request sent.\r\n' },
    );
    const { remote } = await service({ runner, sessions: stubSessions(), terminate });
    await save(remote);
    await remote.connect(base.id, caller.owner);
    await remote.disconnect(base.id);
    expect(terminate).not.toHaveBeenCalled();
    await remote.connect(base.id, caller.owner);
    codes.exit = 255;
    stderr.exit = 'Master refused termination request: Permission denied\r\n';
    stderr.check = 'Master running (pid=5151)\r\n';
    await remote.disconnect(base.id);
    expect(terminate).not.toHaveBeenCalled();
    stderr.check = 'Master running (pid=4242)\r\n';
    await remote.connect(base.id, caller.owner);
    await remote.disconnect(base.id);
    expect(terminate).toHaveBeenCalledExactlyOnceWith(4242);
  });
});

describe('clicked sign-in', () => {
  it('cancels a clicked prompt on timeout and on a canceled sheet', async () => {
    const prompt = vi.fn(() => new Promise<string | null>(() => {}));
    const { remote } = await service({ prompt });
    await save(remote, { host: 'prompt-box' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const connection = remote.connect(base.id, caller.owner);
    await vi.waitFor(() => expect(prompt).toHaveBeenCalled(), { timeout: 3000 });
    await vi.advanceTimersByTimeAsync(remoteLimits.promptTimeoutMs);
    vi.useRealTimers();
    await connection;
    expect(remote.snapshot()[0]!.state).toBe('disconnected');
    const canceled = await service({ prompt: async () => null });
    await save(canceled.remote, { host: 'prompt-box' });
    await canceled.remote.connect(base.id, caller.owner);
    expect(canceled.remote.snapshot()[0]!.state).toBe('disconnected');
  });

  it('routes a host key question to native confirmation before declaring ready', async () => {
    const prompt = vi.fn(async (question: RemotePrompt) =>
      question.kind === 'host-key' ? 'yes' : null,
    );
    const { remote, log } = await service({ prompt });
    await writeFile(log + '.mode', JSON.stringify({ hostKey: true }));
    await save(remote);
    await remote.connect(base.id, caller.owner);
    expect(remote.snapshot()[0]!.state).toBe('ready');
    const asked = prompt.mock.calls[0]![0];
    expect(asked).toMatchObject({ kind: 'host-key', title: 'First connection to “Build box”' });
    expect(asked.text).toContain(
      'ED25519 key fingerprint is SHA256:dF7v73VCVA52XCCI0LR7unENWy9rIM',
    );
  });

  it('refuses a key file it cannot open before ssh starts, and says which', async () => {
    const { runner, calls } = stubRunner();
    const { remote, bin } = await service({ runner, sessions: stubSessions() });
    await save(remote, { identityFile: path.join(bin, 'id_missing') });
    await expect(remote.connect(base.id, caller.owner)).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_SIGN_IN',
      message: expect.stringContaining('“id_missing”'),
    });
    expect(remote.snapshot()[0]!.state).toBe('needs-sign-in');
    expect(calls('master')).toHaveLength(0);
  });

  it('answers a shared-connection question no, without a sheet, and stops the sign-in', async () => {
    let answered: string | null | undefined;
    const runner = vi.fn<SSHRunner>(async (command, options) => {
      if (kindOf(command.args) !== 'master') {
        return { code: 0, stderr: '' };
      }
      answered = await askRelay(options, 'Allow shared connection to build-box? ', 'confirm');
      if (!options.signal?.aborted) {
        await new Promise((resolve) => options.signal?.addEventListener('abort', resolve));
      }
      return { code: 255, stderr: '' };
    });
    const { remote, prompt } = await service({ runner, sessions: stubSessions() });
    await save(remote);
    await expect(remote.connect(base.id, caller.owner)).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_SIGN_IN',
    });
    expect(answered).toBe('no');
    expect(prompt).not.toHaveBeenCalled();
    expect(remote.snapshot()[0]!.state).toBe('needs-sign-in');
  });

  it('withdraws a clicked attempt’s token as soon as the sign-in ends', async () => {
    let environment: SSHRunOptions | undefined;
    const runner = vi.fn<SSHRunner>(async (command, options) => {
      if (kindOf(command.args) === 'master') {
        environment = options;
      }
      return { code: 0, stderr: '' };
    });
    const { remote, prompt } = await service({ runner, sessions: stubSessions() });
    await save(remote);
    await remote.connect(base.id, caller.owner);
    expect(environment?.environment.VIEWER_ASKPASS_TOKEN).toMatch(/^[a-f0-9]{64}$/);
    expect(await askRelay(environment!, 'Password:')).toBeNull();
    expect(prompt).not.toHaveBeenCalled();
  });

  it('does not start a sign-in that Disconnect overtook', async () => {
    const { runner, calls } = stubRunner();
    const { remote } = await service({ runner, sessions: stubSessions() });
    await save(remote);
    const connecting = remote.connect(base.id, caller.owner);
    const disconnecting = remote.disconnect(base.id);
    await Promise.all([connecting, disconnecting]);
    expect(calls('master')).toHaveLength(0);
    expect(remote.snapshot()[0]!.state).toBe('disconnected');
  });

  it('reports slow after four seconds and recovers when the foreground request finishes', async () => {
    let finish: ((value: { type: 'list'; entries: []; truncated: false }) => void) | undefined;
    const sessions = stubSessions(async (_id, _lane, request) =>
      request.type === 'home'
        ? { type: 'path', path: '/' }
        : new Promise((resolve) => {
            finish = resolve;
          }),
    );
    const { remote } = await service({ sessions, runner: stubRunner().runner });
    await save(remote);
    await remote.connect(base.id, caller.owner);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const work = remote.perform(base.id, 'browse', { type: 'list', path: '/' });
    await vi.advanceTimersByTimeAsync(remoteLimits.metadataSlowMs);
    expect(remote.snapshot()[0]!.state).toBe('slow');
    finish!({ type: 'list', entries: [], truncated: false });
    await work;
    expect(remote.snapshot()[0]!.state).toBe('ready');
  });

  it('limits simultaneously active connections to eight', async () => {
    const { remote } = await service({ sessions: stubSessions(), runner: stubRunner().runner });
    for (let index = 0; index < 9; index++) {
      const id = 'server0' + index;
      await remote.request({ type: 'save', connection: { ...base, id } }, caller);
      if (index < 8) {
        await remote.connect(id, caller.owner);
      } else {
        await expect(remote.connect(id, caller.owner)).rejects.toThrow('Disconnect a server');
      }
    }
    expect(remote.snapshot().filter((item) => item.state === 'ready')).toHaveLength(8);
  });
});

describe('idle connections', () => {
  it('close their channels after five minutes and end quietly with their master', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { runner, codes, calls } = stubRunner();
    const sessions = stubSessions();
    const { remote, prompt } = await service({ runner, sessions });
    await save(remote);
    await remote.connect(base.id, caller.owner);
    const release = remote.retain(base.id);
    await vi.advanceTimersByTimeAsync(remoteLimits.idleBrowseMs);
    expect(sessions.release).not.toHaveBeenCalled();
    release();
    await vi.advanceTimersByTimeAsync(remoteLimits.idleBrowseMs);
    expect(sessions.release).toHaveBeenCalledWith(base.id);
    expect(remote.snapshot()[0]!.state).toBe('ready');
    expect(calls('exit')).toHaveLength(0);
    // ControlPersist ends the master ten minutes after its last channel closed.
    codes.check = 255;
    await vi.advanceTimersByTimeAsync(remoteLimits.sshServerAliveIntervalSeconds * 1000);
    await vi.waitFor(() => expect(remote.snapshot()[0]!.state).toBe('saved'));
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(calls('master')).toHaveLength(1);
    expect(prompt).not.toHaveBeenCalled();
    await expect(
      remote.perform(base.id, 'browse', { type: 'list', path: '/' }),
    ).rejects.toMatchObject({ code: 'VIEWER_REMOTE_DISCONNECTED' });
  });

  it('refuse a request when the master ended between checks, instead of signing in', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { runner, codes, calls } = stubRunner();
    const sessions = stubSessions();
    const { remote } = await service({ runner, sessions });
    await save(remote);
    await remote.connect(base.id, caller.owner);
    await vi.advanceTimersByTimeAsync(remoteLimits.idleBrowseMs);
    expect(sessions.release).toHaveBeenCalledTimes(1);
    codes.check = 255;
    const requests = sessions.request.mock.calls.length;
    await expect(
      remote.perform(base.id, 'browse', { type: 'list', path: '/' }),
    ).rejects.toMatchObject({ code: 'VIEWER_REMOTE_DISCONNECTED' });
    expect(sessions.request.mock.calls).toHaveLength(requests);
    expect(remote.snapshot()[0]!.state).toBe('saved');
    expect(calls('master')).toHaveLength(1);
  });

  it('stay ready when a check gets no answer in time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let slow = true;
    // A runner stopped by its timeout reports no exit code.
    const runner = vi.fn<SSHRunner>(async (command) => ({
      code: kindOf(command.args) === 'check' && slow ? null : 0,
      stderr: '',
    }));
    const { remote } = await service({ runner, sessions: stubSessions() });
    await save(remote);
    // The check right after signing in must answer: without a socket nothing can use the master.
    await remote.connect(base.id, caller.owner);
    expect(remote.snapshot()[0]!.state).toBe('unreachable');
    slow = false;
    await remote.connect(base.id, caller.owner);
    expect(remote.snapshot()[0]!.state).toBe('ready');
    slow = true;
    await vi.advanceTimersByTimeAsync(3 * remoteLimits.sshServerAliveIntervalSeconds * 1000);
    expect(remote.snapshot()[0]!.state).toBe('ready');
    expect(runner.mock.calls.filter(([command]) => kindOf(command.args) === 'master')).toHaveLength(
      2,
    );
  });

  it('keep each holder until it releases, however often another releases', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const sessions = stubSessions();
    const { remote } = await service({ sessions, runner: stubRunner().runner });
    await save(remote);
    await remote.connect(base.id, caller.owner);
    const plane = remote.retain(base.id);
    const terminal = remote.retain(base.id);
    remote.offline(base.id);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(remote.snapshot()[0]!.state).toBe('ready'));
    plane();
    plane();
    await vi.advanceTimersByTimeAsync(remoteLimits.idleBrowseMs);
    expect(sessions.release).not.toHaveBeenCalled();
    terminal();
    await vi.advanceTimersByTimeAsync(remoteLimits.idleBrowseMs);
    expect(sessions.release).toHaveBeenCalledTimes(1);
  });
});

describe('reconnecting', () => {
  it('uses bounded backoff and BatchMode without prompts', async () => {
    const { runner, codes, calls } = stubRunner();
    const { remote, prompt } = await service({ runner, sessions: stubSessions() });
    await save(remote);
    await remote.connect(base.id, caller.owner);
    codes.master = 255;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    remote.offline(base.id);
    expect(remote.snapshot()[0]!.state).toBe('offline');
    for (let attempt = 0; attempt < remoteLimits.reconnectAttempts; attempt++) {
      await vi.advanceTimersByTimeAsync(remoteLimits.reconnectDelayMs[Math.min(attempt, 4)]!);
      await vi.waitFor(() => expect(remote.snapshot()[0]!.attempt).toBe(attempt + 1));
    }
    expect(remote.snapshot()[0]!.state).toBe('unreachable');
    expect(calls('master')).toHaveLength(11);
    for (const command of calls('master').slice(1)) {
      expect(command.args).toContain('BatchMode=yes');
    }
    expect(prompt).not.toHaveBeenCalled();
  });

  it.each([
    ['a refused sign-in', {}, 'builder@build-box: Permission denied (publickey).\r\n'],
    ['a silent jump host', { jump: ['first'] }, ''],
  ])('waits for a click after %s instead of retrying', async (_name, patch, stderr) => {
    const { runner, codes, stderr: errors, calls } = stubRunner();
    const { remote } = await service({ runner, sessions: stubSessions() });
    await save(remote, patch);
    await remote.connect(base.id, caller.owner);
    codes.master = 255;
    errors.master = stderr;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    remote.offline(base.id);
    await vi.advanceTimersByTimeAsync(remoteLimits.reconnectDelayMs[0]!);
    await vi.waitFor(() => expect(remote.snapshot()[0]!.state).toBe('needs-sign-in'));
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(calls('master')).toHaveLength(2);
  });

  it('never prompts when the fake ssh requires sign-in during automatic reconnect', async () => {
    const { remote, prompt, log } = await service();
    await save(remote, { host: 'prompt-box' });
    await remote.connect(base.id, caller.owner);
    expect(prompt).toHaveBeenCalledTimes(1);
    remote.offline(base.id);
    await vi.waitFor(() => expect(remote.snapshot()[0]!.state).toBe('needs-sign-in'), {
      timeout: 4000,
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    const commands = (await logs(log)).filter((item) => item.command === 'master');
    expect(commands).toHaveLength(2);
    expect(commands[1]).toMatchObject({
      batch: true,
      askpass: '/usr/bin/false',
      tokenPresent: false,
    });
  });

  it('lets a click replace an automatic attempt, which cannot ask anything', async () => {
    let hang = true;
    const runner = vi.fn<SSHRunner>(
      (command, options) =>
        new Promise((resolve) => {
          const automatic =
            kindOf(command.args) === 'master' && command.args.includes('BatchMode=yes');
          if (!automatic || !hang) {
            resolve({ code: 0, stderr: '' });
            return;
          }
          options.signal?.addEventListener('abort', () => resolve({ code: 255, stderr: '' }));
        }),
    );
    const { remote } = await service({ runner, sessions: stubSessions() });
    await save(remote);
    await remote.connect(base.id, caller.owner);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    remote.offline(base.id);
    await vi.advanceTimersByTimeAsync(remoteLimits.reconnectDelayMs[0]!);
    await vi.waitFor(() => expect(remote.snapshot()[0]!.state).toBe('reconnecting'));
    hang = false;
    await remote.connect(base.id, caller.owner);
    expect(remote.snapshot()[0]!.state).toBe('ready');
    const masters = runner.mock.calls.filter(([command]) => kindOf(command.args) === 'master');
    expect(masters.at(-1)![0].args).toContain('BatchMode=no');
  });

  it('cancels failed reconnect timers before saving an edited endpoint', async () => {
    const { runner, codes } = stubRunner();
    const { remote } = await service({ runner, sessions: stubSessions() });
    await save(remote);
    await remote.connect(base.id, caller.owner);
    codes.master = 255;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    remote.offline(base.id);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(remote.snapshot()[0]!.state).toBe('unreachable'));
    await save(remote, { host: 'changed-endpoint' });
    const count = runner.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(runner.mock.calls).toHaveLength(count);
    expect(remote.snapshot()[0]).toMatchObject({
      state: 'saved',
      connection: { host: 'changed-endpoint' },
    });
  });
});

it('does not read SSH config without the explicit yes and remembers the decision', async () => {
  const ssh = await temporaryRoot('viewer-consent-');
  await writeFile(path.join(ssh, 'config'), 'Host offered\n');
  const { remote } = await service({ sshDirectory: ssh });
  await save(remote);
  expect(
    (await remote.request({ type: 'ssh-config-hosts', id: base.id, consent: false }, caller)).hosts,
  ).toEqual([]);
  expect(remote.snapshot()[0]!.connection.sshConfig).toBe('declined');
  expect(
    (await remote.request({ type: 'ssh-config-hosts', id: base.id, consent: true }, caller)).hosts,
  ).toEqual(['offered']);
  expect(remote.snapshot()[0]!.connection.sshConfig).toBe('allowed');
});

it('rechecks window authority before returning connection records after an async request', async () => {
  const { remote } = await service();
  await save(remote);
  let agentDriven = false;
  const handlers = createRemoteHandlers({ remote, caller: () => ({ ...caller, agentDriven }) });
  const reply = handlers.remote([{ type: 'list' }], caller.owner);
  agentDriven = true;
  await expect(reply).rejects.toMatchObject({ code: 'VIEWER_REMOTE_AGENT_REFUSED' });
});
