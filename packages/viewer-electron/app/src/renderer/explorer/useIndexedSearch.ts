import { useEffect, useState } from 'react';
import type { IndexedResult } from '../../domain/services';
import { queryTooLong } from '../../domain/search/query';
/** Generation ownership drops obsolete replies; a query never copies the full index. */
export function useIndexedSearch(
  query: string,
  root: string | undefined,
  enabled: boolean,
  showHidden = false,
  offset = 0,
  content = false,
  recursive = true,
) {
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let last = 0;
    return window.viewer.onEvent((event) => {
      if (event.type === 'index' && (!event.status.running || Date.now() - last > 2000)) {
        last = Date.now();
        setGeneration((value) => value + 1);
      }
    });
  }, [enabled]);
  const key = JSON.stringify([query, root, showHidden, offset, content, recursive]);
  const [result, setResult] = useState<{ key: string; value: IndexedResult }>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) {
      setResult(undefined);
      setRunning(false);
      return;
    }
    const long = queryTooLong(query);
    if (long) {
      setResult(undefined);
      setRunning(false);
      setError(long);
      return;
    }
    let live = true;
    setRunning(true);
    setError('');
    const timer = setTimeout(() => {
      void window.viewer
        .indexedQuery({ query, root, showHidden, offset, content, recursive })
        .then((value) => {
          if (live) {
            setResult({ key, value });
            setRunning(false);
          }
        })
        .catch((error) => {
          if (live) {
            setError(error.message);
            setRunning(false);
          }
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, root, enabled, showHidden, offset, content, recursive, generation, key]);
  return { result: result?.key === key ? result.value : undefined, running, error };
}
