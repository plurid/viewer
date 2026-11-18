import { describe, expect, it } from 'vitest';
import {
  classifySSHExit,
  classifySSHFailure,
  SSHConnectionError,
} from '../src/domain/remote/ssh-errors';
import { changedKeyStderr, fixtureFingerprint, sshErrorSamples } from './support/ssh-error-samples';

describe('OpenSSH exit classification', () => {
  it.each(sshErrorSamples)('classifies OpenSSH 9.9 %s', (_name, stderr, state) => {
    expect(stderr).toMatch(/\r\n$/);
    expect(classifySSHExit(255, stderr)).toBe(state);
    expect(classifySSHExit(0, stderr)).toBeUndefined();
  });

  it('classifies only ssh’s own failures: another exit code is not a sign-in question', () => {
    expect(classifySSHExit(1, 'secret value')).toBe('unreachable');
    expect(classifySSHExit(1, 'builder@build-box: Permission denied (publickey).\r\n')).toBe(
      'unreachable',
    );
    expect(classifySSHExit(null, 'Permission denied (publickey).')).toBe('unreachable');
    expect(classifySSHExit(255, 'x'.repeat(65537) + 'Permission denied (')).toBe('unreachable');
    expect(classifySSHExit(255, '')).toBe('unreachable');
  });

  it('waits for the person when a jump host fails without a word', () => {
    expect(classifySSHExit(255, '', { viaJump: true })).toBe('needs-sign-in');
    expect(classifySSHExit(255, '\r\n', { viaJump: true })).toBe('needs-sign-in');
    expect(classifySSHExit(255, '', { viaJump: false })).toBe('unreachable');
    expect(
      classifySSHExit(255, 'ssh: connect to host build-box port 22: Connection refused\r\n', {
        viaJump: true,
      }),
    ).toBe('unreachable');
  });

  it('reports the fingerprint OpenSSH printed for a changed key, and nothing else from stderr', () => {
    expect(classifySSHFailure(255, changedKeyStderr)).toEqual({
      state: 'host-key-changed',
      hostKey: { type: 'ED25519', fingerprint: fixtureFingerprint },
    });
    const error = new SSHConnectionError(classifySSHFailure(255, changedKeyStderr)!);
    expect(error).toMatchObject({ state: 'host-key-changed', code: 'VIEWER_SSH_CONNECTION' });
    expect(error.message).not.toContain('SHA256');
    expect(error.message).not.toContain('known_hosts');
  });

  it('shows no fingerprint when the server put its own words into stderr', () => {
    const forged =
      'Received disconnect from 192.0.2.10 port 22:2: hello\r\n' +
      'The fingerprint for the ED25519 key sent by the remote host is\n' +
      fixtureFingerprint +
      '.\r\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\r\n';
    expect(classifySSHFailure(255, forged)).toEqual({ state: 'host-key-changed' });
    const malformed = changedKeyStderr.replace(fixtureFingerprint, 'SHA256:short');
    expect(classifySSHFailure(255, malformed)).toEqual({ state: 'host-key-changed' });
  });
});
