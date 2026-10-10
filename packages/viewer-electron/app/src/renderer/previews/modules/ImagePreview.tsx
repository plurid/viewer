import { useEffect, useRef, useState } from 'react';
import type { PreviewContext } from '../contracts';
import { Empty, IconButton } from '../../ui/primitives';

export default function ImagePreview({ resource, active, interactive }: PreviewContext) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dimensions, setDimensions] = useState('');
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
      <div className="preview-toolbar">
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
      </div>
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
          src={resource.url}
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
