import { remoteConnection } from './connections';
import type { RemoteConnection } from './connections';
import { remoteLimits } from './limits';
import { remoteUTF8Bytes } from './location';

/** `master` signs in once; `sftp` channels, `check` and `exit` go through its control socket. */
export type SSHCommandKind = 'master' | 'sftp' | 'check' | 'exit';

export interface SSHCommand {
  executable: '/usr/bin/ssh';
  args: string[];
}

export interface SSHArgumentOptions {
  kind: SSHCommandKind;
  controlPath: string;
  /** Only a master started by a click may ask the person anything. */
  interactive?: boolean;
}

function socketPathProblem(file: string): string | undefined {
  if (!file.startsWith('/') || file.includes('${') || /[\p{Cc}\p{Cf}]/u.test(file)) {
    return 'Use a private absolute socket path.';
  }
}

/** A Unix socket Viewer binds itself, such as the askpass relay's. */
export function validateSocketPath(file: string): void {
  const problem = socketPathProblem(file);
  if (problem) {
    throw new Error(problem);
  }
  if (remoteUTF8Bytes(file) + 1 > remoteLimits.controlPathBytes) {
    throw new Error('The private socket path is too long.');
  }
}

/**
 * OpenSSH expands `${VARIABLE}` in ControlPath with no escape, and binds the master at the path
 * plus a temporary suffix first, so the budget is smaller than the socket's.
 */
export function validateControlPath(file: string): void {
  const problem = socketPathProblem(file);
  if (problem) {
    throw new Error(problem);
  }
  const bytes = remoteUTF8Bytes(file) + remoteLimits.controlTemporarySuffixBytes + 1;
  if (bytes > remoteLimits.controlPathBytes) {
    throw new Error('The private SSH control socket path is too long.');
  }
}

/** OpenSSH expands percent tokens even in argv paths. Absolute paths also prevent tilde expansion. */
export const sshLiteralPath = (file: string): string => file.replaceAll('%', '%%');

/** A stored IPv6 host keeps its brackets for display; ssh takes the bare address after `--`. */
export const sshHost = (host: string): string => (host.startsWith('[') ? host.slice(1, -1) : host);

export function sshArguments(record: RemoteConnection, options: SSHArgumentOptions): SSHCommand {
  const connection = remoteConnection.parse(record);
  validateControlPath(options.controlPath);
  if (options.interactive && options.kind !== 'master') {
    throw new Error('Only a clicked connection may ask for sign-in.');
  }
  const args = [
    '-S',
    sshLiteralPath(options.controlPath),
    '-o',
    'ControlMaster=' + (options.kind === 'master' ? 'yes' : 'no'),
    '-o',
    'ConnectTimeout=' + remoteLimits.sshConnectTimeoutSeconds,
    '-o',
    'ServerAliveInterval=' + remoteLimits.sshServerAliveIntervalSeconds,
    '-o',
    'ServerAliveCountMax=' + remoteLimits.sshServerAliveCountMax,
    '-o',
    'BatchMode=' + (options.interactive ? 'no' : 'yes'),
    '-o',
    'ClearAllForwardings=yes',
    '-o',
    'ForwardAgent=no',
    '-o',
    'ForwardX11=no',
    '-o',
    'PermitLocalCommand=no',
    '-o',
    'RequestTTY=no',
    '-o',
    'LogLevel=ERROR',
  ];
  if (connection.port !== undefined) {
    args.push('-p', String(connection.port));
  }
  if (connection.user !== undefined) {
    args.push('-l', connection.user);
  }
  if (connection.jump?.length) {
    args.push('-J', connection.jump.join(','));
  }
  if (connection.identityFile !== undefined) {
    args.push('-i', sshLiteralPath(connection.identityFile), '-o', 'IdentitiesOnly=yes');
  }
  if (options.kind === 'master') {
    args.push('-f', '-N', '-M', '-o', 'ControlPersist=' + remoteLimits.controlPersistSeconds);
  } else if (options.kind === 'sftp') {
    args.push('-s');
  } else {
    args.push('-O', options.kind);
  }
  args.push('--', sshHost(connection.host));
  if (options.kind === 'sftp') {
    args.push('sftp');
  }
  return { executable: '/usr/bin/ssh', args };
}
