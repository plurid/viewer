import { execFileSync } from 'node:child_process';

/**
 * The direct build's CFBundleVersion: the number of commits in the checked-out history. It grows
 * with every commit while history is not rewritten, so a release's build is larger than the last
 * one's. A source copy without Git history has none; the packager then uses the version.
 */
export function directBuildNumber(appRoot: string): string | undefined {
  try {
    const count = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
      cwd: appRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return /^[1-9]\d{0,9}$/.test(count) ? count : undefined;
  } catch {
    return undefined;
  }
}
