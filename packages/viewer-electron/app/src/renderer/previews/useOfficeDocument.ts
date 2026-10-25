import { useEffect, useState } from 'react';
import type { DocumentData } from '../../domain/services';
import type { WorksheetWindow } from '../../domain/previews/documents/office';
import type { PreviewContext } from './contracts';

/** A page transition keeps sheet choices available while withholding old cells.
 * Request ownership and the latest key guard late results independently. */
export function useOfficeDocument(context: PreviewContext, worksheet?: WorksheetWindow) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    resource: string;
    key: string;
    data?: DocumentData;
    error?: string;
  }>();
  const key = JSON.stringify([
    context.resource.id,
    worksheet?.sheet,
    worksheet?.fromRow,
    worksheet?.limit,
    attempt,
  ]);
  const enabled = Boolean(worksheet);
  const sheet = worksheet?.sheet,
    fromRow = worksheet?.fromRow,
    limit = worksheet?.limit;
  useEffect(() => {
    const request = enabled
      ? { sheet, fromRow: fromRow ?? 1, limit: limit ?? 100, requestID: crypto.randomUUID() }
      : undefined;
    let alive = true;
    const cancel = () =>
      request
        ? context.services.cancelDocument(context.resource.id, request.requestID).catch(() => {})
        : Promise.resolve();
    const fail = (message: string) =>
      setResult((previous) => ({
        resource: context.resource.id,
        key,
        data: previous?.resource === context.resource.id ? previous.data : undefined,
        error: message,
      }));
    const timer = setTimeout(() => {
      if (!alive) return;
      alive = false;
      fail('The document reader is taking longer than expected. Try again.');
      if (request) void cancel();
      else void context.services.release(context.resource.id).catch(() => {});
    }, 15000);
    const aborted = () => {
      alive = false;
      clearTimeout(timer);
      void cancel();
    };
    context.signal.addEventListener('abort', aborted, { once: true });
    if (context.signal.aborted) aborted();
    else
      context.services
        .document(context.resource.id, request)
        .then((value) => {
          clearTimeout(timer);
          if (alive && !context.signal.aborted)
            setResult({ resource: context.resource.id, key, data: value });
        })
        .catch((error) => {
          clearTimeout(timer);
          if (alive && !context.signal.aborted) fail(String(error.message || error));
        });
    return () => {
      alive = false;
      clearTimeout(timer);
      context.signal.removeEventListener('abort', aborted);
      void cancel();
    };
  }, [context.services, context.resource.id, context.signal, key, enabled, sheet, fromRow, limit]);
  const current = result?.key === key && result.resource === context.resource.id;
  return {
    document: result?.resource === context.resource.id ? result.data : undefined,
    loading: !current,
    error: current ? result.error || '' : '',
    retry: () => setAttempt((value) => value + 1),
  };
}
