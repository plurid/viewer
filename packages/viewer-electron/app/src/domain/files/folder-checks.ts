export interface CheckedFolder {
  directory: boolean;
  path?: string;
}

export const folderCheckLimit = 40;
export const folderCheckConcurrency = 4;
export const folderCheckTimeout = 150;

export function folderVolume(path: string): string | undefined {
  return /^(\/Volumes\/[^/]+)(?:\/|$)/.exec(path)?.[1];
}

/** A timed-out lane retires, keeping outstanding IO bounded while other lanes continue. */
export async function checkFolderCandidates(
  paths: readonly string[],
  check: (path: string) => Promise<CheckedFolder>,
  signal: AbortSignal,
  options: {
    limit?: number;
    checks?: number;
    onResult?(path: string, value: CheckedFolder): void;
    onUpdate?(paths: string[]): void;
  } = {},
): Promise<string[]> {
  const candidates = paths.slice(0, 500);
  const present = new Set<string>();
  const volumes = new Map<string, ReturnType<typeof inspect>>();
  let cursor = 0;
  let checks = 0;
  const limit = options.limit ?? 8;
  const budget = options.checks ?? folderCheckLimit;
  const inspect = async (path: string) => {
    if (signal.aborted || checks >= budget) return undefined;
    checks++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        check(path).then(
          (value) => ({ value }),
          () => ({ value: undefined }),
        ),
        new Promise<{ timeout: true }>((resolve) => {
          timer = setTimeout(() => resolve({ timeout: true }), folderCheckTimeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const result = () => candidates.filter((path) => present.has(path)).slice(0, limit);
  await Promise.all(
    Array.from({ length: folderCheckConcurrency }, async () => {
      while (
        !signal.aborted &&
        cursor < candidates.length &&
        present.size < limit &&
        checks < budget
      ) {
        const path = candidates[cursor++]!;
        const volume = folderVolume(path);
        if (volume) {
          let mounted = volumes.get(volume);
          const owner = !mounted;
          if (!mounted) {
            mounted = inspect(volume);
            volumes.set(volume, mounted);
          }
          const outcome = await mounted;
          if (!outcome) break;
          if ('timeout' in outcome) {
            if (owner) break;
            continue;
          }
          if (!outcome.value?.directory) continue;
        }
        const outcome = await inspect(path);
        if (!outcome || 'timeout' in outcome) break;
        if (signal.aborted) break;
        if (outcome.value) {
          options.onResult?.(path, outcome.value);
          if (outcome.value.directory) {
            present.add(path);
            options.onUpdate?.(result());
          }
        }
      }
    }),
  );
  return signal.aborted ? [] : result();
}
