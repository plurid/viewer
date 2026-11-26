import { execFile, spawn } from 'node:child_process';
import type { ExecFileOptions, SpawnOptions } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

const signingVariables = new Set([
  'VIEWER_UPDATE_SIGNING_KEY',
  'VIEWER_UPDATE_SIGNING_KEY_FILE',
  'VIEWER_LICENSE_SIGNING_KEY',
  'VIEWER_LICENSE_SIGNING_KEY_FILE',
]);

export function assertPreservingBuildEnvironment(): void {
  for (const name of signingVariables) {
    if (name in process.env)
      throw new Error(
        'Use tools/build-preserving.ts to exclude publisher keys from the build environment.',
      );
  }
}

/** Signing keys and their file references belong to the publisher process. */
export function releaseEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !signingVariables.has(name)));
}
export function execRelease(file: string, args: string[], options: ExecFileOptions = {}) {
  return execute(file, args, {
    ...options,
    encoding: 'utf8',
    env: releaseEnvironment(options.env ?? process.env),
  });
}

export function spawnRelease(file: string, args: string[], options: SpawnOptions) {
  return spawn(file, args, { ...options, env: releaseEnvironment(options.env ?? process.env) });
}
