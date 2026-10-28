import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { GitRunner } from './git-process';
import { gitEnvironment, gitSafeOptions, gitOutput } from './git-process';

const execute = promisify(execFile);
let executable: Promise<string> | undefined;
async function systemGit(): Promise<string> {
  return (executable ??= execute('/usr/bin/xcrun', ['--find', 'git'], {
    cwd: '/',
    env: gitEnvironment(),
    timeout: 5000,
    maxBuffer: 32768,
  })
    .then(({ stdout }) => {
      const file = stdout.trim();
      if (!path.isAbsolute(file) || /[\0\r\n]/.test(file))
        throw new Error('System Git is unavailable.');
      return file;
    })
    .catch((error) => {
      executable = undefined;
      throw error;
    }));
}

/** Agent metadata permission must never execute repository filters, even if config changes
 * after preflight. The fixed Git process can read but cannot fork, write or use the network. */
export const runGitInspection: GitRunner = async (directory, args, limit, signal) => {
  if (process.platform !== 'darwin')
    throw new Error(
      'Contained agent Git inspection is currently available on macOS. Use the Git review plane on this platform.',
    );
  signal.throwIfAborted();
  const git = await systemGit();
  signal.throwIfAborted();
  const profile =
    '(version 1)(allow default)(deny file-write* (require-not (literal "/dev/null")))(deny network*)(deny process-fork)' +
    '(deny process-exec (require-not (literal ' +
    JSON.stringify(git) +
    ')))';
  return gitOutput(
    '/usr/bin/sandbox-exec',
    ['-p', profile, git, ...gitSafeOptions, '-C', directory, ...args],
    { ...gitEnvironment(), GIT_WORK_TREE: directory },
    limit,
    signal,
  );
};
