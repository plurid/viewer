import { remoteLimits } from './limits';

export type SSHFailureState = 'needs-sign-in' | 'host-key-changed' | 'unreachable';

/** The key a server offered when its identity changed, as OpenSSH printed it. */
export interface SSHHostKey {
  type: string;
  fingerprint: string;
}

export interface SSHFailure {
  state: SSHFailureState;
  hostKey?: SSHHostKey;
}

export interface SSHFailureContext {
  /** The record names jump hosts: ControlPersist sends the jump's own messages to /dev/null. */
  viaJump?: boolean;
}

// OpenSSH's own wording (sshconnect.c warn_changed_key and check_host_key): a revoked key, a
// changed key, and a changed key reached under another name or address.
const changedKey =
  /REMOTE HOST IDENTIFICATION HAS CHANGED|REVOKED HOST KEY|Host key for \S+ has changed|POSSIBLE DNS SPOOFING DETECTED/i;

// Authentication that a clicked Connect can complete: refused or failed sign-in, an unknown or
// unconfirmed host key, a locked key, or an agent that declined to sign.
const signIn =
  /Permission denied \(|Authentication failed|Too many authentication failures|Host key verification failed|No \S+ host key is known for|sign_and_send_pubkey: signing failed|incorrect passphrase|agent refused operation/i;

const fingerprint =
  /The fingerprint for the ([A-Z0-9-]{2,20}) key sent by the remote host is\s+(SHA256:[A-Za-z0-9+/]{43})\./;

// At LogLevel=ERROR a server's own words reach stderr only in these two messages, and may span
// lines: a fingerprint is not shown when they are present.
const serverText = /Received disconnect from|open failed:/;

/** Only a classification and a validated fingerprint cross the boundary, never stderr itself. */
export function classifySSHFailure(
  code: number | null,
  stderr: string,
  context: SSHFailureContext = {},
): SSHFailure | undefined {
  if (code === 0) {
    return undefined;
  }
  if (code !== 255 || stderr.length > remoteLimits.sshStderrCharacters) {
    return { state: 'unreachable' };
  }
  // A jump host that refused, failed to sign in or is unknown leaves nothing to read. Retrying
  // without the person cannot fix a refusal, so it waits for a click.
  if (context.viaJump && !stderr.trim()) {
    return { state: 'needs-sign-in' };
  }
  if (changedKey.test(stderr)) {
    const offered = serverText.test(stderr) ? null : fingerprint.exec(stderr);
    return offered
      ? { state: 'host-key-changed', hostKey: { type: offered[1]!, fingerprint: offered[2]! } }
      : { state: 'host-key-changed' };
  }
  if (signIn.test(stderr)) {
    return { state: 'needs-sign-in' };
  }
  return { state: 'unreachable' };
}

export function classifySSHExit(
  code: number | null,
  stderr: string,
  context: SSHFailureContext = {},
): SSHFailureState | undefined {
  return classifySSHFailure(code, stderr, context)?.state;
}

const failureMessages: Record<SSHFailureState, string> = {
  'host-key-changed': 'The server identity changed. Check its host key before connecting again.',
  'needs-sign-in': 'Sign in to this server with Connect.',
  unreachable: 'The server could not be reached. Check the address and network.',
};

export class SSHConnectionError extends Error {
  readonly code = 'VIEWER_SSH_CONNECTION';
  readonly state: SSHFailureState;
  readonly hostKey?: SSHHostKey;

  constructor(failure: SSHFailure | SSHFailureState) {
    const value = typeof failure === 'string' ? { state: failure } : failure;
    super(failureMessages[value.state]);
    this.name = 'SSHConnectionError';
    this.state = value.state;
    if (value.hostKey) {
      this.hostKey = value.hostKey;
    }
  }
}
