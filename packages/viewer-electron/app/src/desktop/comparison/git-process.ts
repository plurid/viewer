import { spawn } from 'node:child_process';
import os from 'node:os';

export const gitSafeOptions = [
  '--no-pager',
  '--no-optional-locks',
  '--no-replace-objects',
  '--literal-pathspecs',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.untrackedCache=false',
  '-c',
  'gc.auto=0',
  '-c',
  'maintenance.auto=false',
  '-c',
  'status.submoduleSummary=false',
  '-c',
  'submodule.recurse=false',
  '-c',
  'protocol.allow=never',
  '-c',
  'credential.helper=',
  '-c',
  'core.askPass=/usr/bin/false',
];
export type GitRunner = (
  directory: string,
  args: readonly string[],
  limit: number,
  signal: AbortSignal,
) => Promise<Buffer>;
export const gitEnvironment = () => ({
  PATH: '/usr/bin:/bin',
  HOME: os.homedir(),
  LANG: 'C.UTF-8',
  LC_ALL: 'C',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '/usr/bin/false',
  SSH_ASKPASS: '/usr/bin/false',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_NO_LAZY_FETCH: '1',
  GIT_NO_REPLACE_OBJECTS: '1',
});
/** No shell, inherited Git configuration overrides, credential helpers, or network transports. */
export function gitOutput(
  executable: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  limit: number,
  signal: AbortSignal,
  difference = false,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      signal,
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let size = 0,
      errors = '',
      failure: Error | undefined;
    const stop = (message: string) => {
      failure ??= new Error(message);
      child.kill('SIGKILL');
    };
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) stop('Git output exceeded its size limit.');
      else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (errors.length + chunk.length > 65536) stop('Git diagnostics exceeded their size limit.');
      else errors += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      failure ??= error;
    });
    child.on('close', (code) => {
      if (failure) reject(failure);
      else if (code !== 0 && !(code === 1 && difference))
        reject(new Error(errors.trim().slice(0, 1000) || 'Git is unavailable.'));
      else resolve(Buffer.concat(chunks));
    });
  });
}

export const runGit: GitRunner = (directory, args, limit, signal) =>
  gitOutput(
    '/usr/bin/git',
    [...gitSafeOptions, '-C', directory, ...args],
    gitEnvironment(),
    limit,
    signal,
    args[0] === 'diff' && args.includes('--no-index'),
  );
