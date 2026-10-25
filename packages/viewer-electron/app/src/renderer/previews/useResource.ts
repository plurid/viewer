import { useCallback, useEffect, useRef, useState } from 'react';
import type { Resource } from '../../domain/contracts';

interface Load {
  resource?: Resource;
  signal: AbortSignal;
  error: string;
  code: string;
}

/** One disposable generation per effect run, including React's mount replay.
 * A cancelled native accessor cannot publish into a newer file's preview. */
export function useResource(
  path: string | undefined,
  supplied: Resource | undefined,
  enabled: boolean,
  revision: number,
) {
  const [load, setLoad] = useState<Load>(() => ({
    signal: new AbortController().signal,
    error: '',
    code: '',
  }));
  const current = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    const abort = new AbortController();
    current.current = abort;
    const requestID = crypto.randomUUID();
    let owned: Resource | undefined;
    let pending = !supplied && !!path && enabled;
    setLoad({ resource: supplied, signal: abort.signal, error: '', code: '' });
    const timer = pending
      ? setTimeout(() => {
          if (abort.signal.aborted) return;
          setLoad({
            signal: abort.signal,
            error:
              'File access is taking longer than expected. Try again or open the file in its app.',
            code: '',
          });
          abort.abort();
          void window.viewer.release(requestID).catch(() => {});
        }, 15000)
      : undefined;
    if (pending)
      void window.viewer
        .resource(path!, requestID)
        .then((resource) => {
          pending = false;
          if (abort.signal.aborted) {
            void window.viewer.release(resource.id).catch(() => {});
            return;
          }
          owned = resource;
          setLoad({ resource, signal: abort.signal, error: '', code: '' });
        })
        .catch((error) => {
          if (!abort.signal.aborted)
            setLoad({
              signal: abort.signal,
              error: String(error.message || error),
              code: error.code || '',
            });
        })
        .finally(() => clearTimeout(timer));
    return () => {
      abort.abort();
      clearTimeout(timer);
      if (pending) void window.viewer.release(requestID).catch(() => {});
      if (owned) void window.viewer.release(owned.id).catch(() => {});
    };
  }, [path, supplied, enabled, revision]);
  const cancel = useCallback((error?: string) => {
    current.current?.abort();
    if (error) setLoad((previous) => ({ ...previous, resource: undefined, error }));
  }, []);
  return { ...load, cancel };
}
