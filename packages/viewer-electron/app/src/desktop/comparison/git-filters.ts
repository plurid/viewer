import type { GitRunner } from './git-process';

/** A filter can launch a shell from an otherwise read-only Git status or diff. */
export async function assertNoGitFilters(
  run: GitRunner,
  repo: string,
  signal: AbortSignal,
): Promise<void> {
  const config = (await run(repo, ['config', '--null', '--list'], 1024 * 1024, signal)).toString(
    'utf8',
  );
  for (const row of config.split('\0')) {
    const newline = row.indexOf('\n');
    if (newline < 0) continue;
    if (
      /^filter\..+\.(?:clean|smudge|process)$/i.test(row.slice(0, newline)) &&
      row.slice(newline + 1).trim()
    )
      throw new Error(
        'This repository configures executable Git filters. Use the Git review plane for this repository; agent inspection never runs filters.',
      );
  }
}
