import { useEffect, useState } from 'react';
import type { Resource } from '../../../domain/contracts';
import type { PreviewContext } from '../contracts';
import { Empty, Loading } from '../../ui/primitives';
import ImagePreview from './ImagePreview';
import { cameraRawFormats } from '../../../domain/previews/images/rendered';
import { PreviewToolbar } from '../controls';
import { usePreviewState } from '../state';

/** Every rendered image uses a cancellable private decoder. */
export default function RenderedImagePreview(context: PreviewContext) {
  const { resource, services } = context;
  const [rendered, setRendered] = useState<Resource>();
  const [error, setError] = useState('');
  const raw = cameraRawFormats.includes(resource.entry.extension);
  const [mode, setMode] = usePreviewState<'camera' | 'raw'>(context, 'raw.mode', 'camera');
  useEffect(() => {
    let live = true,
      owned: Resource | undefined;
    setRendered(undefined);
    setError('');
    const requestID = crypto.randomUUID();
    void services
      .rendition(resource.id, { requestID, mode: raw ? mode : 'camera' })
      .then((value) => {
        if (!live) {
          void services.release(value.id);
          return;
        }
        owned = value;
        setRendered(value);
      })
      .catch((value: Error) => {
        if (live) setError(value.message);
      });
    return () => {
      live = false;
      void services.cancelDocument(resource.id, requestID);
      if (owned) void services.release(owned.id);
    };
  }, [resource.id, services, raw, mode]);
  if (error)
    return (
      <Empty icon="warning" title="Preview unavailable" detail={error}>
        {raw && mode === 'raw' && (
          <button onClick={() => setMode('camera')}>Use camera preview</button>
        )}
        {context.retry && <button onClick={context.retry}>Retry preview</button>}
      </Empty>
    );
  if (!rendered)
    return (
      <Loading
        label={
          raw
            ? mode === 'camera'
              ? 'Reading camera preview…'
              : 'Rendering RAW…'
            : 'Rendering preview…'
        }
      />
    );
  return (
    <div className="rendered-image-viewer">
      {raw && (
        <PreviewToolbar context={context}>
          <span className="muted">
            {rendered.derivation?.kind === 'camera'
              ? 'Camera preview'
              : 'RAW rendition · half-size'}
          </span>
          <button
            aria-pressed={mode === 'raw'}
            onClick={() => setMode(mode === 'raw' ? 'camera' : 'raw')}
          >
            {mode === 'raw' ? 'Use camera preview' : 'Render RAW'}
          </button>
        </PreviewToolbar>
      )}
      <ImagePreview
        {...context}
        editImage={undefined}
        optimize={undefined}
        resource={{ ...rendered, entry: { ...rendered.entry, name: resource.entry.name } }}
      />
    </div>
  );
}
