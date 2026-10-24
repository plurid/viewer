import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Resource } from '../../domain/contracts';
import { useViewer } from '../state/store';
import { Empty, Loading } from '../ui/primitives';
import type { ImageComparisonMode } from './modes';

export default function ImageDiff({
  left,
  right,
  mode,
}: {
  left: Resource | null;
  right: Resource | null;
  mode: ImageComparisonMode;
}) {
  const [position, setPosition] = useState(50);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const limit = useViewer((state) => state.settings.settings.previews.maxImagePixels);
  const width = Math.max(left?.dimensions?.width ?? 0, right?.dimensions?.width ?? 0);
  const height = Math.max(left?.dimensions?.height ?? 0, right?.dimensions?.height ?? 0);
  const tooLarge =
    [left, right].some(
      (resource) => resource && (!resource.dimensions || resource.entry.size > 64 * 1024 * 1024),
    ) || width * height * 3 > limit;

  useEffect(() => {
    setReady(false);
    setError('');
    if (mode !== 'difference' || tooLarge) return;
    const controller = new AbortController();
    const worker = new Worker(new URL('./image-diff.worker.ts', import.meta.url), {
      type: 'module',
    });
    let live = true;
    const decode = async (resource: Resource | null) => {
      if (!resource) return null;
      const response = await fetch(resource.url, { signal: controller.signal });
      if (!response.ok) throw new Error('The image resource is unavailable.');
      return createImageBitmap(await response.blob());
    };
    void Promise.allSettled([decode(left), decode(right)])
      .then((results) => {
        const a = results[0].status === 'fulfilled' ? results[0].value : null;
        const b = results[1].status === 'fulfilled' ? results[1].value : null;
        const failure = results.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') {
          a?.close();
          b?.close();
          throw failure.reason;
        }
        if (!live) {
          a?.close();
          b?.close();
          return;
        }
        worker.postMessage(
          { left: a, right: b, width, height, maxPixels: limit },
          [a, b].filter((item): item is ImageBitmap => !!item),
        );
      })
      .catch((failure: Error) => {
        if (live) setError(failure.message);
      });
    worker.onmessage = (event: MessageEvent<{ bitmap?: ImageBitmap; error?: string }>) => {
      if (event.data.error) setError(event.data.error);
      const bitmap = event.data.bitmap;
      if (!bitmap) return;
      const target = canvas.current;
      if (live && target) {
        target.width = bitmap.width;
        target.height = bitmap.height;
        target.getContext('2d')?.drawImage(bitmap, 0, 0);
        setReady(true);
      }
      bitmap.close();
    };
    worker.onerror = () => {
      if (live) setError('Pixel comparison failed. Try another view.');
    };
    return () => {
      live = false;
      controller.abort();
      worker.terminate();
    };
  }, [left, right, mode, width, height, limit, tooLarge]);

  if (tooLarge)
    return (
      <Empty
        title="Image comparison exceeds its preview budget"
        detail="Use smaller images or raise the image pixel limit in Settings."
      />
    );
  if (error) return <Empty title="Image comparison unavailable" detail={error} />;
  const image = (resource: Resource | null, overlay = false) =>
    resource ? (
      <img
        src={resource.url}
        alt={resource.entry.name}
        draggable={false}
        onError={() => setError('An image could not be decoded.')}
        style={
          overlay
            ? {
                width: `${(100 * (resource.dimensions?.width ?? width)) / width}%`,
                height: `${(100 * (resource.dimensions?.height ?? height)) / height}%`,
              }
            : undefined
        }
      />
    ) : (
      <span className="muted">Empty side</span>
    );

  return (
    <div className="image-diff">
      <p className="muted">
        {left ? `${left.dimensions?.width} × ${left.dimensions?.height}` : 'Empty'}
        {' → '}
        {right ? `${right.dimensions?.width} × ${right.dimensions?.height}` : 'Empty'}
      </p>
      {(mode === 'slider' || mode === 'onion') && (
        <label className="image-diff-control">
          {mode === 'slider' ? 'Divider' : 'Right opacity'}
          <input
            type="range"
            min={0}
            max={100}
            value={position}
            aria-label={mode === 'slider' ? 'Comparison divider' : 'Right image opacity'}
            onChange={(event) => setPosition(Number(event.target.value))}
          />
        </label>
      )}
      {mode === 'difference' ? (
        <>
          {!ready && <Loading label="Comparing pixels…" />}
          <canvas
            ref={canvas}
            className="image-difference"
            aria-label="Absolute pixel difference"
          />
        </>
      ) : mode === 'side' ? (
        <div className="image-diff-pair">
          {image(left)}
          {image(right)}
        </div>
      ) : (
        <div
          className="image-diff-overlay"
          style={{ aspectRatio: `${width} / ${height}` } as CSSProperties}
        >
          {image(left, true)}
          <div
            className="image-diff-layer"
            style={
              mode === 'onion'
                ? { opacity: position / 100 }
                : { clipPath: `inset(0 0 0 ${position}%)` }
            }
          >
            {image(right, true)}
          </div>
        </div>
      )}
    </div>
  );
}
