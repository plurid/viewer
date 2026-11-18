export interface AskpassEnvironment {
  helper: string;
  socket: string;
  token: string;
}

/**
 * What OpenSSH, its askpass helper and a ProxyCommand from the person's configuration need:
 * where home is, who is signing in, the agent's socket and Kerberos tickets. Nothing else from
 * Viewer's own environment reaches them, a parent shell's askpass settings and `DISPLAY` included.
 */
const allowed = [
  'HOME',
  'USER',
  'LOGNAME',
  'PATH',
  'SHELL',
  'TMPDIR',
  'LANG',
  'SSH_AUTH_SOCK',
  'KRB5CCNAME',
  'KRB5_CONFIG',
  '__CF_USER_TEXT_ENCODING',
] as const;

/**
 * The environment of masters and file channels. Without a clicked attempt `/usr/bin/false`
 * answers every question. Remote shells build their own: `LC_ALL=C` would reach their locale.
 */
export function remoteEnvironment(attempt?: AskpassEnvironment): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of allowed) {
    const value = process.env[key];
    if (value !== undefined) {
      environment[key] = value;
    }
  }
  environment.PATH ??= '/usr/bin:/bin:/usr/sbin:/sbin';
  environment.LC_ALL = 'C';
  environment.SSH_ASKPASS = attempt?.helper ?? '/usr/bin/false';
  environment.SSH_ASKPASS_REQUIRE = 'force';
  if (attempt) {
    environment.VIEWER_ASKPASS_SOCKET = attempt.socket;
    environment.VIEWER_ASKPASS_TOKEN = attempt.token;
  }
  return environment;
}
