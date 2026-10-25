import { useEffect, useMemo, useRef, useState } from 'react';
import { usePreviewState } from '../state';
import type { PreviewContext } from '../contracts';
import { PreviewToolbar, usePreviewCommands } from '../controls';
import { Empty, IconButton, Loading } from '../../ui/primitives';
import { transformableImage } from '../../../domain/operations/image-conversions';
import { optimizable } from '../../../domain/operations/optimization';

export default function ImagePreview(context: PreviewContext) {
  const { resource, active, interactive } = context;
  const [zoom, setZoom] = usePreviewState(context, 'image.zoom', 1);
  const [pan, setPan] = usePreviewState(context, 'image.pan', { x: 0, y: 0 });
  const [dimensions, setDimensions] = useState('');
  const byteLimited = resource.entry.size > 64000000;
  const large =
    (!!resource.dimensions &&
      resource.dimensions.width * resource.dimensions.height >
        (context.limits?.maxImagePixels ?? 64000000)) ||
    byteLimited;
  const [thumbnail, setThumbnail] = useState('');
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  useEffect(() => {
    if (!large || byteLimited) return;
    let live = true;
    setThumbnail('');
    setThumbnailFailed(false);
    void context.services
      .thumbnail(resource.entry.path, 512)
      .then((value) => {
        if (!live) return;
        if (value) setThumbnail(value);
        else setThumbnailFailed(true);
      })
      .catch(() => {
        if (live) setThumbnailFailed(true);
      });
    return () => {
      live = false;
    };
  }, [large, byteLimited, resource.entry.path, context.services]);
  const [error, setError] = useState(false);
  const available = !error && !byteLimited && !thumbnailFailed && (!large || !!thumbnail);
  const stage = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const region = context.evidence?.anchor.kind === 'image' ? context.evidence.anchor : undefined;
  useEffect(() => {
    const element = image.current;
    if (!element) return;
    const resize = () => setImageSize({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, [available, resource.id]);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!active || !interactive) return;
      event.preventDefault();
      event.stopPropagation();
      setZoom((value) => Math.max(0.1, Math.min(20, value * Math.exp(-event.deltaY * 0.003))));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', wheel);
    };
  }, [active, interactive, available, setZoom]);
  usePreviewCommands(
    context,
    useMemo(
      () => [
        {
          id: 'image-fit',
          label: 'Fit image',
          aliases: ['fi'],
          primary: true,
          available,
          run: () => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          },
        },
        {
          id: 'zoom-in',
          label: 'Zoom in',
          available: available && zoom < 20,
          run: () => setZoom((value) => Math.min(20, value * 1.25)),
        },
        {
          id: 'zoom-out',
          label: 'Zoom out',
          available: available && zoom > 0.1,
          run: () => setZoom((value) => Math.max(0.1, value / 1.25)),
        },
      ],
      [available, zoom, setPan, setZoom],
    ),
  );
  if (byteLimited || thumbnailFailed)
    return (
      <Empty
        icon="image"
        title="Image preview unavailable"
        detail={
          byteLimited
            ? 'This image exceeds the preview file limit (64 MB). Open it in another app to view it.'
            : 'A bounded preview could not be created. Open the image in another app to view it.'
        }
      />
    );
  if (error)
    return (
      <Empty
        icon="image"
        title="Image could not be decoded"
        detail="The image may be damaged or use an unsupported encoding."
      />
    );
  if (large && !thumbnail) return <Loading label="Creating image preview…" />;
  return (
    <div className="image-viewer">
      {large && (
        <p className="inline-warning">
          Large image · showing a bounded preview. Increase the image pixel limit in Settings to
          load the full image.
        </p>
      )}
      <PreviewToolbar context={context}>
        {context.optimize && optimizable(resource.entry) && (
          <button onClick={context.optimize}>Optimize…</button>
        )}
        {context.editImage && transformableImage(resource.entry) && (
          <button onClick={context.editImage}>Image tools…</button>
        )}
        <IconButton
          icon="frame"
          label="Fit image"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        />
        <button
          onClick={() => setZoom((value) => Math.max(0.1, value / 1.25))}
          aria-label="Zoom out"
        >
          −
        </button>
        <span className="tabular">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((value) => Math.min(20, value * 1.25))} aria-label="Zoom in">
          +
        </button>
        <span className="toolbar-spacer" />
        <span className="muted">{dimensions}</span>
      </PreviewToolbar>
      <div
        className="image-stage"
        ref={stage}
        onContextMenu={(event) => {
          if (active && interactive) event.stopPropagation();
        }}
        onPointerDown={(event) => {
          if (active && interactive) event.stopPropagation();
          if (event.button !== 0 || !active || !interactive) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, px: pan.x, py: pan.y };
        }}
        onPointerMove={(event) => {
          if (drag.current && active && interactive)
            setPan({
              x: drag.current.px + event.clientX - drag.current.x,
              y: drag.current.py + event.clientY - drag.current.y,
            });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onDoubleClick={() => {
          if (interactive) {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }
        }}
      >
        <img
          ref={image}
          src={large ? thumbnail || undefined : resource.url}
          alt={resource.entry.name}
          draggable={false}
          onError={() => setError(true)}
          onLoad={(event) =>
            setDimensions(
              `${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`,
            )
          }
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        />
        {region && imageSize.width > 0 && (
          <div
            className="image-evidence-overlay"
            aria-label="Referenced image region"
            style={{
              width: imageSize.width,
              height: imageSize.height,
              transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            }}
          >
            <div
              style={{
                left: region.x * 100 + '%',
                top: region.y * 100 + '%',
                width: Math.min(region.width, 1 - region.x) * 100 + '%',
                height: Math.min(region.height, 1 - region.y) * 100 + '%',
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
