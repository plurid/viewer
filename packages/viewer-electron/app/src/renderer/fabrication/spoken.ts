import type { CheckSession } from './check';
import { countText } from '../../domain/layout/nesting/format';
import { modelPermissionCovers } from '../../domain/models/permissions';
import { getState } from '../state/store';
import { checkSession, clockText, runCheck, subscribeCheck } from './check';

/**
 * A LASER JOB'S CHECK FOR A SPOKEN REQUEST: the plan's step waits for the check to be graded, so
 * that what follows it, such as the cut sheets, acts on its result. The check runs only at the data
 * level its model is already allowed; otherwise the panel asks, and the step waits for the person.
 */

/** One job, however its folder or files were listed, as the check keys it. */
export const sameJob = (one: readonly string[], other: readonly string[]) =>
  [...one].sort().join('\n') === [...other].sort().join('\n');

/** "3 findings, 2 confirmed by Viewer"; a check shown again says when it was made, as its panel
 * does: "Checked at 22:14: no findings". */
export function gradedText(check: CheckSession): string {
  const findings = check.result?.findings ?? [];
  const confirmed = findings.filter((item) => item.grade.status === 'confirmed').length;
  const graded = findings.length
    ? `${countText(findings.length, 'finding')}, ${confirmed} confirmed by Viewer`
    : 'no findings';
  if (check.kept) return `Checked at ${clockText(check.checked ?? Date.now())}: ${graded}`;
  return graded.charAt(0).toUpperCase() + graded.slice(1);
}

/** Runs the check when its model may receive pictures; otherwise says what the panel asks of the
 * person, and the step waits for their Check. */
async function start(
  check: CheckSession,
  progress: (text: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const provider = getState().settings.settings.providers.find(
    (item) => item.id === check.providerID,
  );
  const files = `Check ${countText(check.opening?.sources.length ?? 0, 'file')}`;
  if (!provider?.model)
    return progress(`Choose a model to check with in the check panel, then choose ${files}.`);
  const permission = await window.viewer.providerPermissionGet(provider.id).catch(() => null);
  if (signal.aborted || checkSession() !== check) return;
  if (modelPermissionCovers(permission, provider, 'images')) return void runCheck();
  progress(
    `${provider.name} may not receive pictures yet. Choose Allow pictures for ${provider.name} in the check panel, then ${files}.`,
  );
}

/**
 * The open check of `paths`, once graded. A check shown again unchanged is graded already; a ready
 * or changed one runs as `start` allows. Throws, with why, when it fails, finds nothing to check or
 * closes first.
 */
export function gradedCheck(
  paths: readonly string[],
  progress: (text: string) => void,
  signal: AbortSignal,
): Promise<CheckSession> {
  return new Promise((resolve, reject) => {
    let started = false;
    let settled = false;
    const settle = (outcome: { check: CheckSession } | { error: unknown }) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      signal.removeEventListener('abort', abort);
      if ('check' in outcome) resolve(outcome.check);
      else reject(outcome.error);
    };
    const abort = () => settle({ error: signal.reason });
    const follow = () => {
      const current = checkSession();
      if (!current || !sameJob(current.paths, paths))
        return settle({ error: new Error('The check closed before it was graded.') });
      switch (current.phase) {
        case 'opening':
          return progress('Listing the job’s files');
        case 'comparing':
          return progress(`Comparing the job with the check at ${clockText(current.checked!)}`);
        case 'empty':
          return settle({
            error: new Error(current.nothing?.text ?? 'There is nothing to check.'),
          });
        case 'failed':
          return settle({ error: new Error(current.error ?? 'The check did not finish.') });
        case 'drawing':
        case 'asking':
          return progress(current.progress ?? 'Checking');
        case 'checked':
          if (!current.stale) return settle({ check: current });
          break;
        case 'ready':
          break;
      }
      // ready, or changed since its result: run it once
      if (started) return;
      started = true;
      void start(current, progress, signal).catch((error: unknown) => settle({ error }));
    };
    const unsubscribe = subscribeCheck(follow);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else follow();
  });
}
