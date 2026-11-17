import { childEnvironment } from '../terminals/process-environment';

export interface AskpassEnvironment {
  helper: string;
  socket: string;
  token: string;
}

const inherited = (key: string): boolean =>
  !key.startsWith('SSH_ASKPASS') && !key.startsWith('VIEWER_ASKPASS_') && key !== 'DISPLAY';

/**
 * The environment of masters and file channels. A parent shell's askpass settings must never
 * receive Viewer's authentication prompts, and without a clicked attempt `/usr/bin/false`
 * answers every question. Remote shells build their own: `LC_ALL=C` would reach their locale.
 */
export function remoteEnvironment(attempt?: AskpassEnvironment): Record<string, string> {
  const environment = Object.fromEntries(
    Object.entries(childEnvironment()).filter(([key]) => inherited(key)),
  );
  environment.LC_ALL = 'C';
  environment.SSH_ASKPASS = attempt?.helper ?? '/usr/bin/false';
  environment.SSH_ASKPASS_REQUIRE = 'force';
  if (attempt) {
    environment.VIEWER_ASKPASS_SOCKET = attempt.socket;
    environment.VIEWER_ASKPASS_TOKEN = attempt.token;
  }
  return environment;
}
