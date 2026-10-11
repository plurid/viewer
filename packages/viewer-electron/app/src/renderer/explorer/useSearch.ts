import { useEffect, useRef, useState } from 'react';
import type { FileEntry } from '../../domain/contracts';
import { report } from '../state/store';

/** Search lifetime belongs to a folder plane, independently of its view mode. */
export function useSearch(path: string, query: string, enabled: boolean, showHidden: boolean) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState('');
  const search = useRef('');
  useEffect(() => {
    setEntries([]);
    setSummary('');
    if (!enabled || !query.trim()) {
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
  }, [path, query, enabled, showHidden]);
  return {
    entries,
    running,
    summary,
    cancel: () => {
      if (search.current) void window.viewer.cancelSearch(search.current).catch(report);
      setRunning(false);
    },
  };
}
