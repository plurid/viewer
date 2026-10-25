import { appendFileSync } from 'node:fs';

/** Record the positive removal coverage that a preserved run deliberately cannot establish. */
export function removalBlocked(scenario: string, paths: readonly string[]): boolean {
  if (process.env.VIEWER_TEST_NO_REMOVAL !== '1') return false;
  const report = process.env.VIEWER_TEST_REMOVAL_REPORT;
  if (report)
    appendFileSync(
      report,
      JSON.stringify({ scenario, paths, positiveRemoval: 'unverified', fixtures: 'retained' }) +
        '\n',
      { mode: 0o600 },
    );
  return true;
}
