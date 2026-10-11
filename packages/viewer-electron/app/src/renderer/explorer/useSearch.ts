import { useEffect, useRef, useState } from 'react';
import type { FileEntry } from '../../domain/contracts';
import { useIndexedSearch } from './useIndexedSearch';
import { report } from '../state/store';
const emptyEntries: FileEntry[] = [];

/** Search lifetime belongs to a folder plane, independently of its view mode. */
export function useSearch(path: string, query: string, enabled: boolean, showHidden: boolean) {
  const indexed = useIndexedSearch(query, path, enabled && !!query.trim(), showHidden);
  const fallback = enabled && (indexed.result?.indexed === false || !!indexed.error);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState('');
  const search = useRef('');
  useEffect(() => {
    setEntries([]);
    setSummary('');
    if (!fallback || !query.trim()) {
      setRunning(false);
      return;
    }
    const id = crypto.randomUUID();
    search.current = id;
    setRunning(true);
    const remove = window.viewer.onEvent((event) => {
      if (event.type !== 'search' || event.batch.id !== id) return;
      const { batch } = event;
      setEntries((value) => [...value, ...batch.entries]);
      setRunning(!batch.done);
      setSummary(
        `${batch.visited.toLocaleString()} checked${batch.errors ? ` · ${batch.errors} unavailable` : ''}${batch.truncated ? ' · result limit reached' : ''}`,
      );
    });
    const timer = setTimeout(() => {
      void window.viewer
        .search({ id, root: path, query: query.trim(), showHidden })
        .catch((error) => {
          setRunning(false);
          report(error);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      remove();
      if (search.current === id) search.current = '';
      void window.viewer.cancelSearch(id).catch(report);
    };
  }, [path, query, fallback, showHidden]);
  return {
    // Keep an unchanged empty result stable: command subscriptions invalidate
    // after result changes, so a fresh array here would create a render loop.
    entries: fallback ? entries : indexed.result?.entries || emptyEntries,
    running: fallback ? running : indexed.running,
    summary:
      !enabled || !query.trim()
        ? ''
        : fallback
          ? summary
          : indexed.result?.more
            ? 'More matches available in a search plane'
            : indexed.result?.status.running
              ? 'Indexing in progress · results may be incomplete'
              : 'Indexed search',
    cancel: () => {
      if (search.current) void window.viewer.cancelSearch(search.current).catch(report);
      setRunning(false);
    },
  };
}
