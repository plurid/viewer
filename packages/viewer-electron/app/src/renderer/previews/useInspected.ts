import { useEffect, useState } from 'react';
import type { InspectedFile, InspectedKind } from '../../domain/previews/inspected';
import type { PreviewContext } from './contracts';
import { inspectedLimits } from '../../domain/previews/inspected';
import { formatBytes } from '../../domain/files/entries';
import { errorMessage } from '../../domain/errors';

export type Inspection<T> =
  { status: 'loading' } | { status: 'ready'; file: T } | { status: 'failed'; message: string };

/** What the desktop service read of a certificate, torrent or profile, in its preview worker. */
export function useInspected<K extends InspectedKind>(
  context: PreviewContext,
  kind: K,
): Inspection<Extract<InspectedFile, { kind: K }>> {
  type File = Extract<InspectedFile, { kind: K }>;
  const { resource, services, signal } = context;
  const limit = inspectedLimits[kind];
  const [inspection, setInspection] = useState<Inspection<File>>(() => {
    const cached = services.cachedDocument?.()?.inspected;
    return cached?.kind === kind
      ? { status: 'ready', file: cached as File }
      : { status: 'loading' };
  });
  useEffect(() => {
    if (resource.entry.size > limit) {
      setInspection({
        status: 'failed',
        message: `Viewer reads files of this kind up to ${formatBytes(limit)}.`,
      });
      return;
    }
    let live = true;
    services.document(resource.id).then(
      (document) => {
        if (!live || signal.aborted) return;
        const file = document.inspected;
        setInspection(
          file?.kind === kind
            ? { status: 'ready', file: file as File }
            : { status: 'failed', message: 'Viewer could not read this file.' },
        );
      },
      (error: unknown) => {
        if (live && !signal.aborted)
          setInspection({ status: 'failed', message: errorMessage(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [resource.id, resource.entry.size, services, signal, kind, limit]);
  return inspection;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
/** An ISO time on this computer's clock, or the text as written when it is not a time. */
export function dateText(value: string | undefined): string {
  if (!value) return '';
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : dateFormat.format(time);
}
