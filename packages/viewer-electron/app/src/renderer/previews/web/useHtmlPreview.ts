import { useEffect, useState } from 'react';
import type { HtmlPreview } from '../../../domain/previews/web';
import { errorMessage } from '../../../domain/errors';
import { htmlCapability } from '../../../domain/previews/html-address';
import { report } from '../../state/core';
import type { PreviewContext } from '../contracts';

type HtmlPreviewState =
  | { status: 'loading' }
  | { status: 'closed' }
  | { status: 'ready'; preview: HtmlPreview }
  | { status: 'error'; message: string };

interface LoadedPreview {
  resourceID: string;
  signal: AbortSignal;
  revision: number;
  value: HtmlPreviewState;
}

/** A capability belongs to one resource revision; late grants are closed without mounting a frame. */
export function useHtmlPreview(context: PreviewContext, revision: number): HtmlPreviewState {
  const { resource, signal, services } = context;
  const [loaded, setLoaded] = useState<LoadedPreview>();
  const open = services.htmlPreview;
  const close = services.htmlPreviewClose;
  useEffect(() => {
    let cancelled = false;
    let owned: HtmlPreview | undefined;
    const release = (preview: HtmlPreview) => {
      void close(preview.id).catch(report);
    };
    const accept = (value: HtmlPreviewState) => {
      setLoaded({ resourceID: resource.id, signal, revision, value });
    };
    const stop = () => {
      cancelled = true;
      if (owned) {
        release(owned);
        owned = undefined;
      }
    };
    const abort = () => {
      stop();
      accept({ status: 'closed' });
    };
    if (signal.aborted) {
      accept({ status: 'closed' });
      return;
    }
    accept({ status: 'loading' });
    signal.addEventListener('abort', abort, { once: true });
    void open(resource.id)
      .then((preview) => {
        if (cancelled || signal.aborted) {
          release(preview);
          return;
        }
        const capability = htmlCapability(preview.url);
        if (!capability || capability !== preview.id) {
          release(preview);
          accept({ status: 'error', message: 'The HTML preview address is unavailable.' });
          return;
        }
        owned = preview;
        accept({ status: 'ready', preview });
      })
      .catch((error: unknown) => {
        if (!cancelled && !signal.aborted)
          accept({ status: 'error', message: errorMessage(error) });
      });
    return () => {
      signal.removeEventListener('abort', abort);
      stop();
    };
  }, [resource.id, signal, revision, open, close]);
  if (signal.aborted) return { status: 'closed' };
  if (
    loaded?.resourceID !== resource.id ||
    loaded.signal !== signal ||
    loaded.revision !== revision
  )
    return { status: 'loading' };
  return loaded.value;
}
