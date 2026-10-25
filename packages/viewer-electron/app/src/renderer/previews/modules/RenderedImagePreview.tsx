import { useEffect, useState } from 'react';
import type { Resource } from '../../../domain/contracts';
import type { PreviewContext } from '../contracts';
import { Empty, Loading } from '../../ui/primitives';
import ImagePreview from './ImagePreview';

/** TIFF, HEIC, PSD and camera RAW, shown through a system rendering of at most 4096 pixels. */
export default function RenderedImagePreview(context: PreviewContext) {
  const { resource, services } = context;
  const [rendered, setRendered] = useState<Resource>();
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true,
      owned: Resource | undefined;
    setRendered(undefined);
    setError('');
    void services
      .rendition(resource.id)
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
      if (owned) void services.release(owned.id);
    };
  }, [resource.id, services]);
  if (error)
    return (
      <Empty icon="warning" title="Preview unavailable" detail={error}>
        {context.retry && <button onClick={context.retry}>Retry preview</button>}
      </Empty>
    );
  if (!rendered) return <Loading label="Rendering preview…" />;
  return (
    <ImagePreview
      {...context}
      resource={{ ...rendered, entry: { ...rendered.entry, name: resource.entry.name } }}
    />
  );
}
