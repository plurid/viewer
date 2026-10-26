import { useEffect, useState } from 'react';
import type { Resource } from '../../domain/contracts';
import type { OfficeLayoutMetadata } from '../../domain/previews/documents/layout';
import type { PreviewContext } from './contracts';

interface LayoutLoad {
  key: string;
  signal: AbortSignal;
  resource?: Resource;
  error?: string;
}

/** Own the derived resource independently of its source. Late replies are
 * released, and hiding/changing a view cancels only this consumer's request. */
export function useOfficeLayout(context: PreviewContext, sheet?: string) {
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<LayoutLoad>();
  const [metadata, setMetadata] = useState<{ source: string; value: OfficeLayoutMetadata }>();
  const key = JSON.stringify([context.resource.id, sheet, attempt]);
  const { services, signal, active } = context;
  const id = context.resource.id;
  useEffect(() => {
    if (!active || !services.officeLayout || signal.aborted) return;
    const abort = new AbortController();
    const requestID = crypto.randomUUID();
    let owned: Resource | undefined;
    const cancel = () => {
      abort.abort();
      void services.cancelDocument(id, requestID).catch(() => {});
    };
    signal.addEventListener('abort', cancel, { once: true });
    setLoad({ key, signal: abort.signal });
    void services
      .officeLayout(id, { requestID, sheet: sheet || undefined })
      .then((resource) => {
        if (abort.signal.aborted) {
          void services.release(resource.id).catch(() => {});
          return;
        }
        owned = resource;
        if (resource.office) setMetadata({ source: id, value: resource.office });
        setLoad({ key, signal: abort.signal, resource });
      })
      .catch((error) => {
        if (!abort.signal.aborted)
          setLoad({ key, signal: abort.signal, error: String(error.message || error) });
      });
    return () => {
      cancel();
      signal.removeEventListener('abort', cancel);
      if (owned) void services.release(owned.id).catch(() => {});
    };
  }, [key, id, sheet, services, signal, active]);
  const current = load?.key === key && !load.signal.aborted;
  return {
    resource: current ? load.resource : undefined,
    signal: current ? load.signal : signal,
    error: current ? load.error : undefined,
    metadata: metadata?.source === id ? metadata.value : undefined,
    retry: () => setAttempt((value) => value + 1),
  };
}
