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

/**
 * The one ProxyCommand Viewer passes: a channel whose master is gone must fail, never sign in by
 * itself (with `ControlMaster=no` and no socket, ssh would connect directly).
 */
export const channelProxyCommand = 'ProxyCommand=/usr/bin/false';

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
 * plus a temporary suffix first, so the budget is 86 bytes, not 104. Checked before signing in,
 * because OpenSSH only finds out after the person has.
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

/**
 * `-i` checks the path before expanding `%%`, warns when it finds nothing there and then offers
 * the person's default keys instead. As a configuration line the path is expanded first; quotes
 * keep spaces, and a backslash escapes quotes and backslashes.
 */
export function sshIdentityOption(file: string): string {
  const quoted = sshLiteralPath(file).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return 'IdentityFile="' + quoted + '"';
}

/** A stored IPv6 host keeps its brackets for display; ssh takes the bare address after `--`. */
export const sshHost = (host: string): string => (host.startsWith('[') ? host.slice(1, -1) : host);

/** Where and as whom to sign in: only the master signs in, so only the master needs them. */
function endpointArguments(connection: RemoteConnection): string[] {
  const args: string[] = [];
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
    // Only the chosen key: never the person's other keys or the agent's.
    args.push('-o', sshIdentityOption(connection.identityFile), '-o', 'IdentitiesOnly=yes');
  }
  return args;
}

export function sshArguments(record: RemoteConnection, options: SSHArgumentOptions): SSHCommand {
  const connection = remoteConnection.parse(record);
  validateControlPath(options.controlPath);
  if (options.interactive && options.kind !== 'master') {
    throw new Error('Only a clicked connection may ask for sign-in.');
  }
  const args = [
    '-S',
    sshLiteralPath(options.controlPath),
    // `yes`, never `-M`: a later -M turns `yes` into `ask`, which asks before every session and
    // refuses `-O exit`.
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
  switch (options.kind) {
    case 'master':
      args.push(...endpointArguments(connection));
      args.push('-f', '-N', '-o', 'ControlPersist=' + remoteLimits.controlPersistSeconds);
      break;
    case 'sftp':
      // Without -J: a command-line ProxyJump would take the place of this ProxyCommand.
      args.push('-o', channelProxyCommand, '-s');
      break;
    case 'check':
    case 'exit':
      args.push('-O', options.kind);
      break;
  }
  args.push('--', sshHost(connection.host));
  if (options.kind === 'sftp') {
    args.push('sftp');
  }
  return { executable: '/usr/bin/ssh', args };
}
