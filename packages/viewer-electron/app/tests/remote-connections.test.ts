import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RemoteConnections } from '../src/desktop/remote/connections';
import type { RemoteCaller } from '../src/desktop/remote/connections';
import { remoteConnection } from '../src/domain/remote/connections';
import { createRemoteHandlers } from '../src/desktop/ipc/remote-handlers';
import type { RemoteSessionPort } from '../src/desktop/remote/session';
import type { SSHRunner } from '../src/desktop/remote/control';
import type { RemotePrompt } from '../src/desktop/remote/askpass';
import { buildFakeSSH } from './support/remote-transport';
import { fixtureFingerprint } from './support/ssh-error-samples';
import { temporaryRoot } from '../tools/temporary';
import { remoteLimits } from '../src/domain/remote/limits';

vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() } }));

type Options = ConstructorParameters<typeof RemoteConnections>[0];
type StubSessions = { [Key in keyof RemoteSessionPort]: Mock<RemoteSessionPort[Key]> };
type SSHKind = 'master' | 'check' | 'exit';

const caller: RemoteCaller = { owner: 7, role: 'settings', agentDriven: false };
const base = remoteConnection.parse({ id: 'server01', name: 'Build box', host: 'build-box' });
let fixture: Awaited<ReturnType<typeof buildFakeSSH>>;
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
  const log = path.join(root, 'ssh.jsonl');
  vi.stubEnv('VIEWER_FAKE_SSH_LOG', log);
  const event = vi.fn();
  const prompt = vi.fn(async (_prompt: RemotePrompt): Promise<string | null> => 'test answer');
  const remote = new RemoteConnections({
    dataPath: root,
    worker: fixture.worker,
    helper: '/fixtures/viewer-askpass',
    prompt,
    event,
    backend: 'thread',
    sshExecutable: fixture.sshExecutable,
    temporaryDirectory: sockets,
    ...extra,
  });
  services.push(remote);
  return { remote, root, log, event, prompt };
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
  args.includes('-M') ? 'master' : (args[args.indexOf('-O') + 1] as SSHKind);

/** A runner standing in for ssh: each kind answers with the exit code the test sets. */
function stubRunner(codes: Partial<Record<SSHKind, number>> = {}) {
  const runner = vi.fn<SSHRunner>(async (command) => ({
    code: codes[kindOf(command.args)] ?? 0,
    stderr: 'ssh: connect to host build-box port 22: Connection refused',
  }));
  const calls = (kind: SSHKind) =>
    runner.mock.calls.map(([command]) => command).filter((item) => kindOf(item.args) === kind);
  return { runner, codes, calls };
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

  it('keeps a connection through a new name or consent, and reconnects for a new endpoint', async () => {
    const { runner, calls } = stubRunner();
    const { remote } = await service({ runner, sessions: stubSessions() });
    await save(remote);
    await remote.connect(base.id, caller.owner);
    await save(remote, { name: 'Renamed box', startPath: '/srv' });
    await remote.request({ type: 'ssh-config-hosts', id: base.id, consent: false }, caller);
    expect(remote.snapshot()[0]).toMatchObject({
      state: 'ready',
      connection: { name: 'Renamed box', sshConfig: 'declined' },
    });
    expect(calls('exit')).toHaveLength(0);
    await save(remote, { port: 2222 });
    expect(remote.snapshot()[0]).toMatchObject({ state: 'saved', connection: { port: 2222 } });
    expect(calls('exit')).toHaveLength(1);
  });
});

describe('fake ssh and SFTP connection lifecycle', () => {
  it('connects, serves primitives through the worker and quiesces before exit', async () => {
    const quiesce = vi.fn(async () => {});
    const { remote, log, event } = await service({ quiesce });
    await save(remote);
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
    expect(commands.filter((item) => item.command === 'sftp')).toHaveLength(3);
    for (const command of commands.filter((item) => item.command === 'sftp')) {
      expect(command).toMatchObject({
        batch: true,
        askpass: '/usr/bin/false',
        tokenPresent: false,
      });
    }
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
    expect(await readFile(log, 'utf8')).not.toMatch(/test answer|VIEWER_ASKPASS_TOKEN/);
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
    const { remote } = await service();
    await save(remote, { host: 'changed-box' });
    await remote.connect(base.id, caller.owner);
    expect(remote.snapshot()[0]).toMatchObject({
      state: 'host-key-changed',
      hostKey: { type: 'ED25519', fingerprint: fixtureFingerprint },
    });
    await save(remote, { host: 'build-box' });
    await remote.connect(base.id, caller.owner);
    expect(remote.snapshot()[0]!.state).toBe('ready');
    expect(remote.snapshot()[0]!.hostKey).toBeUndefined();
  });

  it('cancels an unanswered prompt on Disconnect', async () => {
    const prompt = vi.fn(() => new Promise<string | null>(() => {}));
    const { remote } = await service({ prompt });
    await save(remote, { host: 'prompt-box' });
    const connecting = remote.connect(base.id, caller.owner);
    await vi.waitFor(() => expect(prompt).toHaveBeenCalled());
    await remote.disconnect(base.id);
    await connecting;
    expect(remote.snapshot()[0]!.state).toBe('disconnected');
  });

  it('reopens idle channels through the same master without signing in again', async () => {
    // The master is a stand-in so fake time never cuts a real process short; channels are real.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { runner, calls } = stubRunner();
    const { remote, log } = await service({ runner });
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
    await writeFile(log + '.mode', JSON.stringify({ failure: 'subsystem request failed' }));
    await expect(
      remote.perform(base.id, 'walk', { type: 'list', path: '/' }),
    ).rejects.toBeDefined();
    await vi.waitFor(async () =>
      expect((await logs(log)).some((item) => item.command === 'check')).toBe(true),
    );
    await writeFile(log + '.mode', JSON.stringify({}));
    const listing = await remote.perform(base.id, 'walk', { type: 'list', path: '/' });
    expect(listing.type).toBe('list');
    expect(remote.snapshot()[0]!.state).toBe('ready');
    const commands = await logs(log);
    expect(commands.filter((item) => item.command === 'master')).toHaveLength(1);
    expect(commands.filter((item) => item.command === 'exit')).toHaveLength(0);
  });

  it('goes offline and reconnects in BatchMode when a lost channel had no master left', async () => {
    const { remote, log, prompt } = await service();
    await save(remote);
    await remote.connect(base.id, caller.owner);
    await writeFile(
      log + '.mode',
      JSON.stringify({
        checkDrop: true,
        failure: 'ssh: connect to host build-box port 22: Connection refused',
      }),
    );
    await remote.perform(base.id, 'walk', { type: 'list', path: '/' }).catch(() => {});
    await vi.waitFor(() => expect(remote.snapshot()[0]!.state).toBe('unreachable'), {
      timeout: 5000,
    });
    await remote.disconnect(base.id);
    const masters = (await logs(log)).filter((item) => item.command === 'master');
    expect(masters).toHaveLength(2);
    expect(masters[1]).toMatchObject({ batch: true, askpass: '/usr/bin/false' });
    expect(prompt).not.toHaveBeenCalled();
  });

  it('quits inside the two-second master budget', async () => {
    const { remote, log } = await service();
    await save(remote);
    await remote.connect(base.id, caller.owner);
    const start = performance.now();
    await remote.close();
    expect(performance.now() - start).toBeLessThan(remoteLimits.quitTimeoutMs);
    expect((await logs(log)).at(-1).command).toBe('exit');
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

  it('keep plane holders across reconnects and release each holder once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const sessions = stubSessions();
    const { remote } = await service({ sessions, runner: stubRunner().runner });
    await save(remote);
    await remote.connect(base.id, caller.owner);
    const release = remote.retain(base.id);
    remote.offline(base.id);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(remote.snapshot()[0]!.state).toBe('ready'));
    await vi.advanceTimersByTimeAsync(remoteLimits.idleBrowseMs);
    expect(sessions.release).not.toHaveBeenCalled();
    release();
    release();
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
          const automatic = command.args.includes('-M') && command.args.includes('BatchMode=yes');
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
    const masters = runner.mock.calls.filter(([command]) => command.args.includes('-M'));
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

describe('clicked sign-in', () => {
  it('cancels a clicked prompt on timeout and on a cancelled sheet', async () => {
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
    const cancelled = await service({ prompt: async () => null });
    await save(cancelled.remote, { host: 'prompt-box' });
    await cancelled.remote.connect(base.id, caller.owner);
    expect(cancelled.remote.snapshot()[0]!.state).toBe('disconnected');
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
    expect(asked.kind).toBe('host-key');
    expect(asked.text).toContain("can't be established. ED25519 key fingerprint is SHA256:");
    expect(asked.text).not.toMatch(/\n/);
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
