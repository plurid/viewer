import { useEffect, useMemo, useRef, useState } from 'react';
import { usePreviewState } from '../state';
import type { PreviewContext } from '../contracts';
import { PreviewToolbar, usePreviewCommands } from '../controls';
import { Empty, IconButton } from '../../ui/primitives';

export default function ImagePreview(context: PreviewContext) {
  const { resource, active, interactive } = context;
  const [zoom, setZoom] = usePreviewState(context, 'image.zoom', 1);
  const [pan, setPan] = usePreviewState(context, 'image.pan', { x: 0, y: 0 });
  const [dimensions, setDimensions] = useState('');
  const large =
    (!!resource.dimensions &&
      resource.dimensions.width * resource.dimensions.height >
        (context.limits?.maxImagePixels ?? 64000000)) ||
    resource.entry.size > 64000000;
  const [thumbnail, setThumbnail] = useState('');
  useEffect(() => {
    if (!large) return;
    let live = true;
    void context.services.thumbnail(resource.entry.path, 512).then((value) => {
      if (live) setThumbnail(value);
    });
    return () => {
      live = false;
    };
  }, [large, resource.entry.path]);
  const [error, setError] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
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
    const stop = (event: Event) => {
      if (active && interactive) event.stopPropagation();
    };
    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('pointerdown', stop);
    element.addEventListener('contextmenu', stop);
    return () => {
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('pointerdown', stop);
      element.removeEventListener('contextmenu', stop);
    };
  }, [active, interactive]);
  usePreviewCommands(
    context,
    useMemo(
      () => [
        {
          id: 'image-fit',
          label: 'Fit image',
          aliases: ['fi'],
          primary: true,
          available: !error,
          run: () => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          },
        },
        {
          id: 'zoom-in',
          label: 'Zoom in',
          available: !error && zoom < 20,
          run: () => setZoom((value) => Math.min(20, value * 1.25)),
        },
        {
          id: 'zoom-out',
          label: 'Zoom out',
          available: !error && zoom > 0.1,
          run: () => setZoom((value) => Math.max(0.1, value / 1.25)),
        },
      ],
      [error, zoom],
    ),
  );
  if (error)
    return (
      <Empty
        icon="image"
        title="Image could not be decoded"
        detail="The image may be damaged or use an unsupported encoding."
      />
    );
  return (
    <div className="image-viewer">
      {large && (
        <p className="inline-warning">
          Large image · showing a bounded preview. Adjust the limit in Settings to load the full
          image.
        </p>
      )}
      <PreviewToolbar context={context}>
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
        onPointerDown={(event) => {
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
      </div>
    </div>
  );
}
