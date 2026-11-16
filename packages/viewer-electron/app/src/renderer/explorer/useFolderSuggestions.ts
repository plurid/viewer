import { useEffect, useMemo, useState } from 'react';
import type { FolderVisits } from '../../domain/files/folder-visits';
import { rankFrecent, rankFolderJump } from '../../domain/files/folder-visits';
import { useViewer } from '../state/core';
import { checkFolderCandidates, folderCheckLimit } from '../../domain/files/folder-checks';
import { knowFolder, knownFolderPaths } from './folder-availability';

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

export function useFolderSuggestions(query: string, enabled = true, jump = false) {
  const visits = useViewer((state) => state.saved.visits) ?? emptyVisits;
  const signature = JSON.stringify(
    Object.entries(visits).sort(([first], [second]) => first.localeCompare(second)),
  );
  // Saving an equal snapshot must not empty an open list or repeat its metadata reads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const candidates = useMemo(
    () => (jump ? rankFolderJump : rankFrecent)(visits, query, Date.now()),
    [signature, query, jump],
  );
  const limit = jump ? 10 : folderSuggestionLimit;
  const known = useMemo(() => knownFolderPaths(), [candidates]);
  const initial = useMemo(
    () => (jump ? candidates.filter((path) => known.has(path)).slice(0, limit) : emptyPaths),
    [candidates, known, jump, limit],
  );
  const complete = jump && (initial.length === limit || initial.length === candidates.length);
  const [result, setResult] = useState<{
    candidates: readonly string[];
    paths: readonly string[];
    checking: boolean;
  }>();
  useEffect(() => {
    if (!enabled || !candidates.length || complete) return;
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        const publish = (paths: string[], checking: boolean) => {
          if (!controller.signal.aborted)
            setResult((previous) => ({
              candidates,
              checking,
              paths: [
                ...new Set([
                  ...(previous?.candidates === candidates ? previous.paths : initial),
                  ...paths,
                ]),
              ].slice(0, limit),
            }));
        };
        void checkFolderCandidates(
          candidates,
          (path) =>
            jump && known.has(path)
              ? Promise.resolve({ directory: true })
              : window.viewer.stat(path),
          controller.signal,
          {
            limit,
            onResult: (path, value) => knowFolder(path, value.directory),
            onUpdate: (paths) => publish(paths, true),
          },
        ).then((paths) => {
          publish(paths, false);
        });
      },
      jump ? 0 : 80,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [candidates, enabled, complete, initial, jump, known, limit]);
  const current = enabled && result?.candidates === candidates;
  return {
    paths: current ? result.paths : enabled ? initial : emptyPaths,
    checking: enabled && candidates.length > 0 && !complete && (!current || result.checking),
    hasHistory: Object.keys(visits).length > 0,
  };
}
