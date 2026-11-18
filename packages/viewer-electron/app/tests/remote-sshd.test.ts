import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { closeSync, openSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { RemoteConnections } from '../src/desktop/remote/connections';
import type { RemoteCaller } from '../src/desktop/remote/connections';
import type { RemotePrompt } from '../src/desktop/remote/askpass';
import type { RemoteConnectionState } from '../src/domain/remote/status';
import type { RemoteConnection } from '../src/domain/remote/connections';
import { buildFakeSSH } from './support/remote-transport';
import { temporaryRoot } from '../tools/temporary';

// Qualification against a real OpenSSH server on loopback (design: tests/remote-sshd.test.ts).
// Opt in with VIEWER_TEST_SSHD=1. Everything is scratch: host and user keys from ssh-keygen, a
// client configuration passed with -F (never ~/.ssh), its own known_hosts, no agent
// (`IdentityAgent none`, SSH_AUTH_SOCK removed), `IdentitiesOnly yes`, 127.0.0.1 only. The server
// stops at the end. Folders come from tools/temporary.ts and are kept for review.

vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() } }));

const enabled = process.env.VIEWER_TEST_SSHD === '1' && process.platform === 'darwin';
const passphrase = 'viewer test passphrase';
const person: RemoteCaller = { owner: 1, role: 'viewer', agentDriven: false };
const settings: RemoteCaller = { owner: 2, role: 'settings', agentDriven: false };

interface Scratch {
  root: string;
  port: number;
  closedPort: number;
  sshd: ChildProcess;
  sshdLog: string;
  config: string;
  wrapper: string;
  helper: string;
  worker: string;
  knownHosts: string;
  home: string;
}

let scratch: Scratch;

const keygen = (...args: string[]) =>
  execFileSync('/usr/bin/ssh-keygen', ['-q', ...args], { stdio: 'ignore' });

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

async function listening(port: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (open) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The scratch sshd did not start; see ' + scratch.sshdLog);
}

const signIns = () =>
  (readFileSync(scratch.sshdLog, 'utf8').match(/Accepted publickey/g) ?? []).length;

/** This test's ssh processes: every one runs with the scratch configuration. */
const sshProcesses = () =>
  execFileSync('/bin/ps', ['-o', 'pid=,command=', '-U', String(process.getuid!())], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter((line) => line.includes('-F ' + scratch.config))
    .map((line) => Number(line.trim().split(' ')[0]));

const fingerprint = (file: string) =>
  execFileSync('/usr/bin/ssh-keygen', ['-l', '-E', 'sha256', '-f', file], {
    encoding: 'utf8',
  }).split(' ')[1]!;

async function setUp(): Promise<Scratch> {
  // Sockets need a short parent: macOS allows 104 bytes for a socket path.
  const root = await temporaryRoot('viewer-sshd-', '/private/tmp');
  const home = path.join(root, 'home');
  await mkdir(path.join(home, 'sub'), { recursive: true });
  await writeFile(path.join(home, 'hello.txt'), 'hello from a real server\n');
  keygen('-t', 'ed25519', '-N', '', '-C', 'viewer-test-host', '-f', path.join(root, 'host'));
  keygen('-t', 'ed25519', '-N', '', '-C', 'viewer-test-other-host', '-f', path.join(root, 'other'));
  keygen(
    '-t',
    'ed25519',
    '-N',
    passphrase,
    '-C',
    'viewer-test-locked',
    '-f',
    path.join(root, 'id_locked'),
  );
  keygen('-t', 'ed25519', '-N', '', '-C', 'viewer-test-plain', '-f', path.join(root, 'id_plain'));
  await writeFile(
    path.join(root, 'authorized_keys'),
    readFileSync(path.join(root, 'id_locked.pub'), 'utf8') +
      readFileSync(path.join(root, 'id_plain.pub'), 'utf8'),
  );
  const port = await freePort();
  const closedPort = await freePort();
  const user = os.userInfo().username;
  const sshdLog = path.join(root, 'sshd.log');
  await writeFile(
    path.join(root, 'sshd_config'),
    [
      'ListenAddress 127.0.0.1',
      'Port ' + port,
      'HostKey ' + path.join(root, 'host'),
      'PidFile ' + path.join(root, 'sshd.pid'),
      'AuthorizedKeysFile ' + path.join(root, 'authorized_keys'),
      'AllowUsers ' + user,
      'UsePAM no',
      'StrictModes no',
      'PubkeyAuthentication yes',
      'PasswordAuthentication no',
      'KbdInteractiveAuthentication no',
      'PermitUserRC no',
      'PermitUserEnvironment no',
      'PermitTTY no',
      'AllowAgentForwarding no',
      // The jump host is this same server.
      'AllowTcpForwarding yes',
      'X11Forwarding no',
      'UseDNS no',
      'LogLevel VERBOSE',
      'Subsystem sftp internal-sftp -d ' + home,
      '',
    ].join('\n'),
  );
  const knownHosts = path.join(root, 'known_hosts');
  await writeFile(knownHosts, '');
  const config = path.join(root, 'ssh_config');
  await writeFile(
    config,
    [
      'Host jumpbox',
      '  HostName 127.0.0.1',
      '  Port ' + port,
      '  IdentityFile ' + path.join(root, 'id_plain'),
      'Host jumpclosed',
      '  HostName 127.0.0.1',
      '  Port ' + closedPort,
      'Host *',
      '  UserKnownHostsFile ' + knownHosts,
      '  GlobalKnownHostsFile /dev/null',
      '  IdentitiesOnly yes',
      '  IdentityAgent none',
      '  AddKeysToAgent no',
      '  UseKeychain no',
      '  UpdateHostKeys no',
      '  HashKnownHosts no',
      '  CheckHostIP no',
      '',
    ].join('\n'),
  );
  const wrapper = path.join(root, 'ssh');
  await writeFile(
    wrapper,
    "#!/bin/sh\nexec /usr/bin/env -u SSH_AUTH_SOCK /usr/bin/ssh -F '" + config + '\' "$@"\n',
    { mode: 0o700 },
  );
  const helper = path.join(root, 'viewer-askpass');
  execFileSync(
    'xcrun',
    [
      'swiftc',
      '-O',
      path.resolve('tools/askpass.swift'),
      '-o',
      helper,
      '-module-cache-path',
      path.join(root, 'swift-cache'),
    ],
    { stdio: 'ignore', timeout: 240_000 },
  );
  const { worker } = await buildFakeSSH();
  const logFile = openSync(sshdLog, 'a');
  const sshd = spawn('/usr/sbin/sshd', ['-D', '-e', '-f', path.join(root, 'sshd_config')], {
    stdio: ['ignore', 'ignore', logFile],
  });
  closeSync(logFile);
  const value = {
    root,
    port,
    closedPort,
    sshd,
    sshdLog,
    config,
    wrapper,
    helper,
    worker,
    knownHosts,
    home,
  };
  scratch = value;
  await listening(port);
  return value;
}

interface Session {
  remote: RemoteConnections;
  prompts: RemotePrompt[];
  states: RemoteConnectionState[];
  close(): Promise<void>;
}

/** A fresh RemoteConnections against the scratch server; `answer` stands in for the sheets. */
async function session(
  answer: (prompt: RemotePrompt) => string | null = (prompt) =>
    prompt.kind === 'host-key' ? 'yes' : prompt.kind === 'secret' ? passphrase : null,
): Promise<Session> {
  vi.stubEnv('VIEWER_REMOTE', '1');
  const data = await temporaryRoot('viewer-sshd-data-');
  const sockets = path.join(scratch.root, 's' + Math.random().toString(36).slice(2, 6));
  await mkdir(sockets, { mode: 0o700 });
  const prompts: RemotePrompt[] = [];
  const states: RemoteConnectionState[] = [];
  const remote = new RemoteConnections({
    dataPath: data,
    worker: scratch.worker,
    helper: scratch.helper,
    backend: 'thread',
    sshExecutable: scratch.wrapper,
    temporaryDirectory: sockets,
    prompt: async (prompt) => {
      prompts.push(prompt);
      return answer(prompt);
    },
    event: (snapshots) => {
      const state = snapshots[0]?.state;
      if (state && states.at(-1) !== state) {
        states.push(state);
      }
    },
  });
  return { remote, prompts, states, close: () => remote.close() };
}

async function saved(
  remote: RemoteConnections,
  patch: Partial<RemoteConnection> = {},
): Promise<string> {
  const id = 'sshd' + Math.random().toString(36).slice(2, 8);
  await remote.request(
    {
      type: 'save',
      connection: {
        id,
        name: 'Loopback',
        host: '127.0.0.1',
        port: scratch.port,
        user: os.userInfo().username,
        identityFile: path.join(scratch.root, 'id_locked'),
        autoConnect: false,
        sshConfig: 'not-asked',
        ...patch,
      },
    },
    settings,
  );
  return id;
}

const list = async (
  remote: RemoteConnections,
  id: string,
  lane: 'browse' | 'transfer' | 'walk',
) => {
  const reply = await remote.perform(id, lane, { type: 'list', path: scratch.home });
  return reply.type === 'list'
    ? reply.entries.flatMap((entry) => (entry.kind === 'entry' ? [entry.name] : [])).sort()
    : [];
};

describe.runIf(enabled)('remote planes against a loopback sshd', () => {
  beforeAll(async () => {
    await setUp();
  }, 300_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (scratch?.sshd.exitCode === null) {
      const stopped = new Promise((resolve) => scratch.sshd.once('exit', resolve));
      scratch.sshd.kill('SIGTERM');
      await stopped;
    }
  });

  it('signs in once with a locked key, reuses the master on every lane and after idle, and ends it', async () => {
    const { remote, prompts, close } = await session();
    try {
      const id = await saved(remote);
      const before = signIns();
      await remote.request({ type: 'connect', id }, person);
      expect(remote.snapshot()[0]!.state).toBe('ready');
      expect(signIns() - before).toBe(1);
      expect(prompts.map((prompt) => prompt.kind)).toEqual(['host-key', 'secret']);
      expect(prompts[1]).toMatchObject({ title: 'Passphrase for key “id_locked”' });
      for (const lane of ['browse', 'walk', 'transfer'] as const) {
        expect(await list(remote, id, lane)).toEqual(['hello.txt', 'sub']);
      }
      await (remote as unknown as { idle(id: string): Promise<void> }).idle(id);
      expect(await list(remote, id, 'browse')).toEqual(['hello.txt', 'sub']);
      expect(signIns() - before).toBe(1);
      expect(prompts).toHaveLength(2);
      expect(sshProcesses().length).toBeGreaterThan(0);
      await remote.request({ type: 'disconnect', id }, person);
      await vi.waitFor(() => expect(sshProcesses()).toEqual([]), { timeout: 3000 });
    } finally {
      await close();
    }
  }, 60_000);

  it('never lets a channel sign in by itself once the master is gone', async () => {
    const { remote, prompts, states, close } = await session();
    try {
      const id = await saved(remote);
      await remote.request({ type: 'connect', id }, person);
      const before = signIns();
      const asked = prompts.length;
      for (const pid of sshProcesses()) {
        process.kill(pid, 'SIGKILL');
      }
      await expect(list(remote, id, 'transfer')).rejects.toBeDefined();
      // The automatic reconnect cannot unlock the key without asking, so it waits for a click.
      await vi.waitFor(() => expect(remote.snapshot()[0]!.state).toBe('needs-sign-in'), {
        timeout: 15_000,
      });
      expect(signIns() - before).toBe(0);
      expect(prompts).toHaveLength(asked);
      expect(states).toContain('offline');
    } finally {
      await close();
    }
  }, 60_000);

  it('signs in through a jump host, and waits for a click when the jump host is down', async () => {
    const { remote, close } = await session();
    try {
      const plain = path.join(scratch.root, 'id_plain');
      const id = await saved(remote, { identityFile: plain, jump: ['jumpbox'] });
      await remote.request({ type: 'connect', id }, person);
      expect(remote.snapshot()[0]!.state).toBe('ready');
      expect(await list(remote, id, 'browse')).toEqual(['hello.txt', 'sub']);
      await remote.request({ type: 'disconnect', id }, person);
      const down = await saved(remote, { identityFile: plain, jump: ['jumpclosed'] });
      await remote.request({ type: 'connect', id: down }, person);
      const state = remote.snapshot().find((item) => item.connection.id === down)!.state;
      expect(state).toBe('needs-sign-in');
    } finally {
      await close();
    }
  }, 60_000);

  it('refuses a changed host key, shows its fingerprint and offers no way around it', async () => {
    const { remote, prompts, close } = await session();
    try {
      const other = readFileSync(path.join(scratch.root, 'other.pub'), 'utf8').split(' ');
      const original = readFileSync(scratch.knownHosts, 'utf8');
      await writeFile(
        scratch.knownHosts,
        '[127.0.0.1]:' + scratch.port + ' ' + other[0] + ' ' + other[1] + '\n',
      );
      try {
        const id = await saved(remote, { identityFile: path.join(scratch.root, 'id_plain') });
        await remote.request({ type: 'connect', id }, person);
        expect(remote.snapshot()[0]).toMatchObject({
          state: 'host-key-changed',
          hostKey: {
            type: 'ED25519',
            fingerprint: fingerprint(path.join(scratch.root, 'host.pub')),
          },
        });
        expect(prompts).toEqual([]);
      } finally {
        await writeFile(scratch.knownHosts, original);
      }
    } finally {
      await close();
    }
  }, 60_000);

  it('ends every master within two seconds of Quit', async () => {
    const { remote, close } = await session();
    const id = await saved(remote, { identityFile: path.join(scratch.root, 'id_plain') });
    await remote.request({ type: 'connect', id }, person);
    expect(sshProcesses().length).toBeGreaterThan(0);
    const started = performance.now();
    await close();
    expect(performance.now() - started).toBeLessThan(2000);
    await vi.waitFor(() => expect(sshProcesses()).toEqual([]), { timeout: 3000 });
  }, 60_000);
});
