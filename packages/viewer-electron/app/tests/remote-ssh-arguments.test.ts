import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { remoteConnection } from '../src/domain/remote/connections';
import {
  channelProxyCommand,
  sshArguments,
  sshIdentityOption,
  validateControlPath,
  validateSocketPath,
} from '../src/domain/remote/ssh-arguments';
import type { SSHCommandKind } from '../src/domain/remote/ssh-arguments';

const base = remoteConnection.parse({ id: 'server01', name: 'Build', host: 'build-box' });
const kinds: SSHCommandKind[] = ['master', 'sftp', 'check', 'exit'];
const everything = remoteConnection.parse({
  ...base,
  port: 2222,
  user: 'builder',
  jump: ['first', 'bob@[2001:db8::1]:2200'],
  identityFile: '/keys/100% "work" key',
});

describe('fixed OpenSSH argv', () => {
  it.each(kinds)('snapshots %s arguments', (kind) => {
    expect(sshArguments(base, { kind, controlPath: '/tmp/viewer-test/c1' })).toMatchSnapshot();
  });

  it('snapshots a clicked master with every record option', () => {
    expect(
      sshArguments(
        { ...everything, host: '[::1]' },
        { kind: 'master', controlPath: '/tmp/100%/c1', interactive: true },
      ),
    ).toMatchSnapshot();
  });

  it.each([
    { host: '-oProxyCommand=x' },
    { user: '-lroot' },
    { port: 0 },
    { jump: ['-oProxyCommand=x'] },
    { identityFile: '~/.ssh/key' },
    { identityFile: 'C:\\key' },
    { identityFile: '/keys/line\nkey' },
    { identityFile: '/keys/${HOME}/key' },
    { extraOptions: ['StrictHostKeyChecking=no'] },
  ])('rejects hostile records before building %j', (patch) => {
    expect(() =>
      sshArguments({ ...base, ...patch }, { kind: 'master', controlPath: '/tmp/c1' }),
    ).toThrow();
  });

  it('never emits an arbitrary option, a host key bypass or ask mode', () => {
    for (const kind of kinds) {
      const command = sshArguments(everything, { kind, controlPath: '/tmp/c1' });
      expect(command.executable).toBe('/usr/bin/ssh');
      expect(command.args).not.toContain('-M');
      expect(command.args).not.toContain('-i');
      const proxies = command.args.filter((value) => /ProxyCommand/i.test(value));
      expect(proxies).toEqual(kind === 'sftp' ? [channelProxyCommand] : []);
      expect(command.args.join(' ')).not.toMatch(/StrictHostKeyChecking=no/);
      expect(command.args.at(command.args.indexOf('--') + 1)).toBe('build-box');
      expect(command.args).toContain('BatchMode=yes');
    }
    expect(() =>
      sshArguments(base, { kind: 'sftp', controlPath: '/tmp/c1', interactive: true }),
    ).toThrow();
  });

  it('gives only the master the endpoint and key: a channel cannot sign in', () => {
    for (const kind of ['sftp', 'check', 'exit'] as const) {
      const { args } = sshArguments(everything, { kind, controlPath: '/tmp/c1' });
      for (const flag of ['-p', '-l', '-J']) {
        expect(args).not.toContain(flag);
      }
      expect(args.join(' ')).not.toMatch(/IdentityFile|IdentitiesOnly/);
    }
    const master = sshArguments(everything, { kind: 'master', controlPath: '/tmp/c1' }).args;
    expect(master).toEqual(
      expect.arrayContaining([
        '-p',
        '2222',
        '-l',
        'builder',
        '-J',
        'first,bob@[2001:db8::1]:2200',
        'IdentityFile="/keys/100%% \\"work\\" key"',
        'IdentitiesOnly=yes',
      ]),
    );
  });

  it('quotes a key path for a configuration line, escaping what OpenSSH would read', () => {
    expect(sshIdentityOption('/keys/plain')).toBe('IdentityFile="/keys/plain"');
    expect(sshIdentityOption('/keys/a b%c"d\\e')).toBe('IdentityFile="/keys/a b%%c\\"d\\\\e"');
  });
});

describe('socket paths', () => {
  // OpenSSH binds `<ControlPath>.<16 characters>` first, inside macOS's 104-byte sun_path.
  it('leaves room for the temporary name OpenSSH binds before its control socket', () => {
    expect(() => validateControlPath('/' + 'a'.repeat(85))).not.toThrow();
    expect(() => validateControlPath('/' + 'a'.repeat(86))).toThrow('too long');
    expect(() => validateSocketPath('/' + 'a'.repeat(102))).not.toThrow();
    expect(() => validateSocketPath('/' + 'a'.repeat(103))).toThrow('too long');
    expect(() => sshArguments(base, { kind: 'master', controlPath: '/' + 'a'.repeat(90) })).toThrow(
      'too long',
    );
  });

  it('refuses relative paths, controls and environment expansion', () => {
    for (const file of ['tmp/c1', '/tmp/c\n1', '/tmp/${HOME}/c1', '/tmp/c\u202e1']) {
      expect(() => validateControlPath(file), JSON.stringify(file)).toThrow();
      expect(() => validateSocketPath(file), JSON.stringify(file)).toThrow();
    }
  });
});

/** `ssh -G` prints the configuration ssh would use and exits: no network, no ~/.ssh with -F. */
function effectiveConfiguration(args: string[]): Map<string, string[]> {
  const output = execFileSync('/usr/bin/ssh', ['-G', '-F', '/dev/null', ...args], {
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin' },
  });
  const configuration = new Map<string, string[]>();
  for (const line of output.split('\n')) {
    const space = line.indexOf(' ');
    if (space > 0) {
      const key = line.slice(0, space);
      configuration.set(key, [...(configuration.get(key) ?? []), line.slice(space + 1)]);
    }
  }
  return configuration;
}

describe.runIf(process.platform === 'darwin')('as the system OpenSSH reads the argv', () => {
  it.each(kinds)('%s', (kind) => {
    const interactive = kind === 'master';
    const { args } = sshArguments(everything, {
      kind,
      controlPath: '/tmp/viewer-test/c1',
      interactive,
    });
    const value = (key: string) => effectiveConfiguration(args).get(key)?.[0];
    // `true`, never `ask`: ask mode questions every session and refuses -O exit.
    expect(value('controlmaster')).toBe(kind === 'master' ? 'true' : 'false');
    expect(value('controlpath')).toBe('/tmp/viewer-test/c1');
    expect(value('batchmode')).toBe(interactive ? 'no' : 'yes');
    expect(value('forwardagent')).toBe('no');
    expect(value('clearallforwardings')).toBe('yes');
    expect(value('permitlocalcommand')).toBe('no');
    expect(value('loglevel')).toBe('ERROR');
    if (kind === 'master') {
      expect(value('controlpersist')).toBe('600');
      expect(value('forkafterauthentication')).toBe('yes');
      expect(value('identitiesonly')).toBe('yes');
      expect(effectiveConfiguration(args).get('identityfile')).toEqual(['/keys/100%% "work" key']);
      expect(value('proxyjump')).toBe('first,bob@[2001:db8::1]:2200');
      expect(value('port')).toBe('2222');
      expect(value('user')).toBe('builder');
    } else {
      expect(value('proxyjump')).toBeUndefined();
    }
    expect(value('proxycommand')).toBe(kind === 'sftp' ? '/usr/bin/false' : undefined);
  });
});

it.each(Array.from({ length: 16 }, (_, mask) => mask))(
  'snapshots every optional record combination %i',
  (mask) => {
    const record = {
      ...base,
      ...(mask & 1 ? { user: 'builder' } : {}),
      ...(mask & 2 ? { port: 2222 } : {}),
      ...(mask & 4 ? { jump: ['first', 'user@[::1]:2200'] } : {}),
      ...(mask & 8 ? { identityFile: '/keys/key with %' } : {}),
    };
    expect(
      kinds.map((kind) =>
        sshArguments(record, { kind, controlPath: '/tmp/ctl/c1', interactive: kind === 'master' }),
      ),
    ).toMatchSnapshot();
  },
);
