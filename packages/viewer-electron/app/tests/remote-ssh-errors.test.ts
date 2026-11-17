import { describe, expect, it } from 'vitest';
import {
  classifySSHExit,
  classifySSHFailure,
  SSHConnectionError,
} from '../src/domain/remote/ssh-errors';
import { changedKeyStderr, fixtureFingerprint, sshErrorSamples } from './support/ssh-error-samples';

describe('OpenSSH exit classification', () => {
  it.each(sshErrorSamples)('classifies OpenSSH 9.9 %s', (_name, stderr, state) => {
    expect(classifySSHExit(255, stderr)).toBe(state);
    expect(classifySSHExit(0, stderr)).toBeUndefined();
  });

  it('keeps unknown failures bounded and plain', () => {
    expect(classifySSHExit(1, 'secret value')).toBe('unreachable');
    expect(classifySSHExit(null, 'Permission denied (publickey).')).toBe('unreachable');
    expect(classifySSHExit(255, 'x'.repeat(65537) + 'Permission denied (')).toBe('unreachable');
    expect(classifySSHExit(255, '')).toBe('unreachable');
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
      'Received disconnect from 192.0.2.10 port 22:2: hello\n' +
      'The fingerprint for the ED25519 key sent by the remote host is\n' +
      fixtureFingerprint +
      '.\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\n';
    expect(classifySSHFailure(255, forged)).toEqual({ state: 'host-key-changed' });
    const malformed = changedKeyStderr.replace(fixtureFingerprint, 'SHA256:short');
    expect(classifySSHFailure(255, malformed)).toEqual({ state: 'host-key-changed' });
  });
});
