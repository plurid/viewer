import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { PreviewHost } from './PreviewHost';

type HostProps = Omit<ComponentProps<typeof PreviewHost>, 'path' | 'resource'>;

/** A preview shows something real: no progress left, and a picture, canvas or some text. */
export function previewShows(element: Element): boolean {
  if (element.querySelector('.loading')) return false;
  if ([...element.querySelectorAll('canvas')].some((canvas) => canvas.width > 0)) return true;
  if (
    [...element.querySelectorAll('img')].some((image) => image.complete && image.naturalWidth > 0)
  )
    return true;
  return (element.textContent ?? '').trim().length > 20;
}

/** How long the next preview may load out of sight before it shows its own progress. */
const holdLimit = 1000;

interface Layer {
  id: number;
  path: string;
}

/**
 * Moving to another file keeps the shown preview until the next one has something to show, so
 * the preview never goes blank between files. The next one loads out of sight, each with its own
 * file access; the earlier one is closed when the next is revealed.
 */
export function HeldPreview({ path, ...props }: HostProps & { path: string }) {
  const [layers, setLayers] = useState<Layer[]>(() => [{ id: 0, path }]);
  const counter = useRef(1);
  // before paint, so the change of path never shows a frame without the held preview
  useLayoutEffect(() => {
    setLayers((current) =>
      current.at(-1)!.path === path
        ? current
        : // the shown preview stays; a file passed over on the way is dropped
          [current[0]!, { id: counter.current++, path }],
    );
  }, [path]);
  const waiting = layers.length > 1 ? layers.at(-1) : undefined;
  const incoming = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!waiting) return;
    const started = performance.now();
    let frame = 0;
    const check = () => {
      const element = incoming.current;
      if (element && (previewShows(element) || performance.now() - started > holdLimit)) {
        setLayers((current) => current.slice(-1));
        return;
      }
      frame = requestAnimationFrame(check);
    };
    frame = requestAnimationFrame(check);
    return () => cancelAnimationFrame(frame);
  }, [waiting]);
  return (
    <div className="held-preview">
      {layers.map((layer) => {
        const hidden = layer === waiting;
        return (
          <div
            key={layer.id}
            ref={hidden ? incoming : undefined}
            className={hidden ? 'held-preview-layer held-preview-waiting' : 'held-preview-layer'}
            aria-hidden={hidden || undefined}
          >
            <PreviewHost path={layer.path} {...props} />
          </div>
        );
      })}
    </div>
  );
}
