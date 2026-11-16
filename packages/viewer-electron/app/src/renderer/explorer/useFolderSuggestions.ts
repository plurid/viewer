import { pathMapper } from '../../domain/files/changes';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { FolderVisits, Visit } from '../../domain/files/folder-visits';
import { rankFrecent, rankFolderJump } from '../../domain/files/folder-visits';
import { useViewer } from '../state/core';
import {
  checkFolderCandidates,
  folderCheckLimit,
  FolderCheckPool,
} from '../../domain/files/folder-checks';
import {
  knowFolder,
  knownFolderPaths,
  knownFolderSnapshot,
  subscribeKnownFolders,
  subscribeFolderRemaps,
} from './folder-availability';

export const folderSuggestionChecks = folderCheckLimit;
export const folderSuggestionLimit = 8;
const emptyPaths: readonly string[] = [];
const emptyVisits: FolderVisits = {};
const metadataChecks = new FolderCheckPool({ timeout: false });
export type FolderSuggestionMode = 'habit' | 'jump';

/** Debounced callers check only the leading candidates, using asynchronous desktop metadata IO.
 * Failed checks hide a folder for this query without forgetting an unmounted volume. */
export async function existingFolders(
  paths: readonly string[],
  check: (path: string) => Promise<{ directory: boolean }>,
  signal: AbortSignal,
): Promise<string[]> {
  return checkFolderCandidates(paths, check, signal);
}

export function useFolderSuggestions(
  query: string,
  enabled = true,
  mode: FolderSuggestionMode = 'habit',
) {
  const jump = mode === 'jump';
  const cache = useSyncExternalStore(subscribeKnownFolders, knownFolderSnapshot);
  const visits = useViewer((state) => state.saved.visits) ?? emptyVisits;
  const signature = JSON.stringify(
    Object.entries(visits).sort(([first], [second]) => first.localeCompare(second)),
  );
  // Saving an equal snapshot must not empty an open list or repeat its metadata reads.
  const candidates = useMemo(() => {
    const recorded = Object.fromEntries(JSON.parse(signature) as [string, Visit][]);
    return (jump ? rankFolderJump : rankFrecent)(recorded, query, Date.now());
  }, [signature, query, jump]);
  const limit = jump ? 10 : folderSuggestionLimit;
  const initial = useMemo(() => {
    const known = cache.paths;
    const prefix: string[] = [];
    if (jump)
      for (const path of candidates) {
        if (!known.has(path) || prefix.length === limit) break;
        prefix.push(path);
      }
    return prefix.length ? prefix : emptyPaths;
  }, [candidates, jump, limit, cache]);
  const [result, setResult] = useState<{
    key: string;
    order: readonly string[];
    paths: readonly string[];
    checking: boolean;
    incomplete: boolean;
  }>();
  const key = `${cache.generation}:${mode}:${query}`;
  useEffect(
    () =>
      subscribeFolderRemaps((changes) => {
        const map = pathMapper(changes);
        setResult(
          (previous) =>
            previous && {
              ...previous,
              order: previous.order.map(map),
              paths: previous.paths.map(map),
            },
        );
      }),
    [],
  );
  useEffect(() => {
    if (!enabled || !candidates.length) return;
    const known = new Set(candidates.filter((path) => knownFolderPaths().has(path)));
    const initial = jump
      ? candidates.filter((path) => known.has(path)).slice(0, limit)
      : emptyPaths;
    if (jump && (initial.length === limit || initial.length === candidates.length)) return;
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        let incomplete = false;
        const publish = (paths: string[], checking: boolean) => {
          if (!controller.signal.aborted)
            setResult((previous) => {
              const kept = previous?.key === key ? previous : undefined;
              const order = [...new Set([...(kept?.order ?? []), ...candidates])];
              const present = new Set([...(kept?.paths ?? initial), ...paths]);
              return {
                key,
                order,
                checking,
                incomplete,
                paths: order.filter((path) => present.has(path)).slice(0, limit),
              };
            });
        };
        void checkFolderCandidates(
          candidates,
          (path) =>
            jump && known.has(path)
              ? Promise.resolve({ directory: true })
              : (window.viewer.folderCheck ?? window.viewer.stat)(path),
          controller.signal,
          {
            limit,
            pool: metadataChecks,
            onIncomplete: () => {
              incomplete = true;
            },
            onResult: (path, value) => knowFolder(path, value.directory, value.path),
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
  }, [candidates, enabled, jump, limit, key]);
  const current = enabled && result?.key === key;
  const hasHistory = Object.keys(visits).length > 0;
  const visible = useMemo(() => {
    if (!enabled || !hasHistory) return emptyPaths;
    if (!current) return initial;
    const present = new Set([...result.paths, ...initial]);
    const seen = new Set<string>();
    return [...new Set([...result.order, ...initial])]
      .filter((path) => {
        const identity = cache.identities.get(path) ?? path;
        if (!present.has(path) || seen.has(identity)) return false;
        seen.add(identity);
        return true;
      })
      .slice(0, limit);
  }, [enabled, hasHistory, current, result, initial, cache, limit]);
  return {
    paths: visible,
    incomplete: current && result.incomplete,
    checking:
      enabled &&
      candidates.length > 0 &&
      !(jump && (initial.length === limit || initial.length === candidates.length)) &&
      (!current || result.checking),
    hasHistory,
  };
}
