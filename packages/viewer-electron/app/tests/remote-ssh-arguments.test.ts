import { describe, expect, it } from 'vitest';
import { remoteConnection } from '../src/domain/remote/connections';
import {
  sshArguments,
  validateControlPath,
  validateSocketPath,
} from '../src/domain/remote/ssh-arguments';
import type { SSHCommandKind } from '../src/domain/remote/ssh-arguments';

const base = remoteConnection.parse({ id: 'server01', name: 'Build', host: 'build-box' });
const kinds: SSHCommandKind[] = ['master', 'sftp', 'check', 'exit'];

describe('fixed OpenSSH argv', () => {
  it.each(kinds)('snapshots %s arguments', (kind) => {
    expect(sshArguments(base, { kind, controlPath: '/tmp/viewer-test/c1' })).toMatchSnapshot();
  });

  it('snapshots a clicked master with every record option', () => {
    expect(
      sshArguments(
        {
          ...base,
          host: '[::1]',
          port: 2222,
          user: 'builder',
          jump: ['first', 'bob@[2001:db8::1]:2200'],
          identityFile: '/keys/100% key',
        },
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

  it('never emits arbitrary options or a host key bypass', () => {
    for (const kind of kinds) {
      const command = sshArguments(base, { kind, controlPath: '/tmp/c1' });
      expect(command.executable).toBe('/usr/bin/ssh');
      expect(command.args.join(' ')).not.toMatch(/ProxyCommand|StrictHostKeyChecking=no/);
      expect(command.args.at(command.args.indexOf('--') + 1)).toBe('build-box');
      expect(command.args).toContain('BatchMode=yes');
    }
    expect(() =>
      sshArguments(base, { kind: 'sftp', controlPath: '/tmp/c1', interactive: true }),
    ).toThrow();
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
