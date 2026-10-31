export interface ProfileEvaluationOptions {
  mode: 'inspect' | 'run' | 'replay';
  source?: string;
  profile?: string;
  provider?: string;
  out?: string;
  jobs: string[];
  repeat: number;
  retries: number;
}

const jobIDs = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7', 'J8'];

/** No token argument or environment fallback: a live run uses the selected desktop profile. */
export function profileEvaluationOptions(argv: readonly string[]): ProfileEvaluationOptions {
  const flags = new Set(['inspect', 'run']);
  const values = new Set(['profile', 'provider', 'out', 'jobs', 'repeat', 'retries', 'replay']);
  const found = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    const key = arg.startsWith('--') ? arg.slice(2) : '';
    if ((!flags.has(key) && !values.has(key)) || found.has(key))
      throw new Error(
        'Use --inspect or --run, with profile/provider/out/jobs/repeat/retries options.',
      );
    if (flags.has(key)) {
      found.set(key, 'true');
      continue;
    }
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`--${key} needs a value.`);
    found.set(key, value);
  }
  if (['inspect', 'run', 'replay'].filter((mode) => found.has(mode)).length !== 1)
    throw new Error(
      'Choose --inspect (no API calls), --run (generated jobs), or --replay <answers.json>.',
    );
  const mode = found.has('run') ? 'run' : found.has('replay') ? 'replay' : 'inspect';
  if (mode === 'inspect' && [...found.keys()].some((key) => !['inspect', 'profile'].includes(key)))
    throw new Error('--inspect takes only an optional --profile.');
  if (mode !== 'inspect' && !found.has('out'))
    throw new Error(`--${mode} needs a new --out folder.`);
  if (mode === 'replay' && [...found.keys()].some((key) => !['replay', 'out'].includes(key)))
    throw new Error(
      '--replay takes a retained answers file and a new --out folder; it does not open a profile.',
    );
  const number = (name: string, fallback: number, least: number, most: number) => {
    const value = found.has(name) ? Number(found.get(name)) : fallback;
    if (!Number.isInteger(value) || value < least || value > most)
      throw new Error(`--${name} takes a whole number from ${least} to ${most}.`);
    return value;
  };
  const jobs =
    found.get('jobs') === 'all'
      ? [...jobIDs]
      : (found.get('jobs') ?? 'J1,J7').split(',').map((value) => value.trim().toUpperCase());
  if (jobs.some((job) => !jobIDs.includes(job)) || new Set(jobs).size !== jobs.length)
    throw new Error('--jobs takes unique IDs J1 to J8, separated by commas, or all.');
  return {
    mode,
    ...(found.has('replay') ? { source: found.get('replay')! } : {}),
    ...(found.has('profile') ? { profile: found.get('profile')! } : {}),
    ...(found.has('provider') ? { provider: found.get('provider')! } : {}),
    ...(found.has('out') ? { out: found.get('out')! } : {}),
    jobs,
    repeat: number('repeat', 1, 1, 3),
    retries: number('retries', 1, 0, 2),
  };
}
