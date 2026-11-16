import { useEffect, useMemo, useState } from 'react';
import type { FolderVisits } from '../../domain/files/folder-visits';
import { rankFrecent } from '../../domain/files/folder-visits';
import { useViewer } from '../state/core';
import { checkFolderCandidates, folderCheckLimit } from '../../domain/files/folder-checks';
import { knowFolder } from './folder-availability';

export const folderSuggestionChecks = folderCheckLimit;
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
  return checkFolderCandidates(paths, check, signal);
}

export function useFolderSuggestions(query: string, enabled = true) {
  const visits = useViewer((state) => state.saved.visits) ?? emptyVisits;
  const signature = JSON.stringify(
    Object.entries(visits).sort(([first], [second]) => first.localeCompare(second)),
  );
  // Saving an equal snapshot must not empty an open list or repeat its metadata reads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const candidates = useMemo(() => rankFrecent(visits, query, Date.now()), [signature, query]);
  const [result, setResult] = useState<{
    candidates: readonly string[];
    paths: readonly string[];
    checking: boolean;
  }>();
  useEffect(() => {
    if (!enabled || !candidates.length) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const publish = (paths: string[], checking: boolean) => {
        if (!controller.signal.aborted)
          setResult((previous) => ({
            candidates,
            checking,
            paths: [
              ...new Set([
                ...(previous?.candidates === candidates ? previous.paths : []),
                ...paths,
              ]),
            ].slice(0, folderSuggestionLimit),
          }));
      };
      void checkFolderCandidates(
        candidates,
        (path) => window.viewer.stat(path),
        controller.signal,
        {
          onResult: (path, value) => knowFolder(path, value.directory),
          onUpdate: (paths) => publish(paths, true),
        },
      ).then((paths) => {
        publish(paths, false);
      });
    }, 80);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [candidates, enabled]);
  const current = enabled && result?.candidates === candidates;
  return {
    paths: current ? result.paths : emptyPaths,
    checking: enabled && candidates.length > 0 && (!current || result.checking),
    hasHistory: Object.keys(visits).length > 0,
  };
}
