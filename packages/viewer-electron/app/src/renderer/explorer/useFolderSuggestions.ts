import { useEffect, useMemo, useState } from 'react';
import type { FolderVisits } from '../../domain/files/folder-visits';
import { rankFrecent } from '../../domain/files/folder-visits';
import { useViewer } from '../state/core';

export const folderSuggestionChecks = 40;
export const folderSuggestionLimit = 8;
const emptyPaths: readonly string[] = [];
const emptyVisits: FolderVisits = {};

/** Debounced callers check only the leading candidates, using asynchronous desktop metadata IO.
 * Failed checks hide a folder for this query without forgetting an unmounted volume. */
export async function existingFolders(
  paths: readonly string[],
  check: (path: string) => Promise<{ directory: boolean }>,
  signal: AbortSignal,
): Promise<string[]> {
  const candidates = paths.slice(0, folderSuggestionChecks);
  const present = new Set<string>();
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, candidates.length) }, async () => {
      while (!signal.aborted && cursor < candidates.length) {
        const path = candidates[cursor++]!;
        try {
          if ((await check(path)).directory) present.add(path);
        } catch {
          // Unavailable or inaccessible folders remain in local history for a later visit.
        }
      }
    }),
  );
  return signal.aborted ? [] : candidates.filter((path) => present.has(path));
}

export function useFolderSuggestions(query: string, enabled = true) {
  const visits = useViewer((state) => state.saved.visits) ?? emptyVisits;
  const candidates = useMemo(() => rankFrecent(visits, query, Date.now()), [visits, query]);
  const [result, setResult] = useState<{
    candidates: readonly string[];
    paths: readonly string[];
  }>();
  useEffect(() => {
    if (!enabled || !candidates.length) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void existingFolders(candidates, (path) => window.viewer.stat(path), controller.signal).then(
        (paths) => {
          if (!controller.signal.aborted)
            setResult({ candidates, paths: paths.slice(0, folderSuggestionLimit) });
        },
      );
    }, 80);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [candidates, enabled]);
  const current = enabled && result?.candidates === candidates;
  return {
    paths: current ? result.paths : emptyPaths,
    checking: enabled && candidates.length > 0 && !current,
  };
}
