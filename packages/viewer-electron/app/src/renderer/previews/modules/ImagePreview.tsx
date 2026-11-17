import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePreviewState } from '../state';
import type { PreviewContext, QuarterTurn } from '../contracts';
import { PreviewToolbar, usePreviewCommands } from '../controls';
import { usePreviewKeys } from '../keys';
import {
  nearestTurn,
  normalAngle,
  sideways,
  turnPoint,
  turnedFit,
  useRotateGesture,
} from '../rotation';
import { headerItem } from '../../workspace/header-overflow';
import { Empty, IconButton, Loading } from '../../ui/primitives';
import { transformableImage } from '../../../domain/operations/image-conversions';
import { optimizable } from '../../../domain/operations/optimization';
import { boxRegion, fitRegion } from '../../../domain/files/regions';
import { EvidenceOverlay } from '../EvidenceOverlay';

/** The stage's margin around a fitted picture (previews.css, `.image-stage img`). */
const stageMargin = 40;

export default function ImagePreview(context: PreviewContext) {
  const { resource, active, interactive } = context;
  const [zoom, setZoom] = usePreviewState(context, 'image.zoom', 1);
  const [pan, setPan] = usePreviewState(context, 'image.pan', { x: 0, y: 0 });
  // the view's quarter turn, clockwise, remembered with the file's view; the picture never turns
  const [turn, setTurn] = usePreviewState(context, 'image.turn', 0);
  // how far two fingers have turned it on the trackpad, until they stop
  const [twist, setTwist] = useState(0);
  const twisting = useRef(0);
  // a quarter turn eases into place; a twist follows the fingers as they go
  const [easing, setEasing] = useState(false);
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
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [room, setRoom] = useState({ width: 0, height: 0 });
  const region = context.evidence?.anchor.kind === 'image' ? context.evidence.anchor : undefined;
  useEffect(() => {
    const element = image.current;
    const frame = stage.current;
    if (!element || !frame) return;
    const resize = () => {
      setImageSize({ width: element.clientWidth, height: element.clientHeight });
      setRoom({
        width: frame.clientWidth - stageMargin,
        height: frame.clientHeight - stageMargin,
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    observer.observe(frame);
    resize();
    return () => observer.disconnect();
  }, [available, resource.id]);
  // Turned, the picture is drawn larger or smaller than the stylesheet lays it out, so that it
  // still fits the stage as a whole at zoom 1.
  const fit = turnedFit(imageSize, natural, room, turn + twist);
  // the shortest way round to the turn: from 270 to 0 is a quarter on, not three back
  const shown = useRef(turn);
  let angle = turn + twist;
  while (angle - shown.current > 180) angle -= 360;
  while (angle - shown.current < -180) angle += 360;
  shown.current = angle;
  useEffect(() => {
    if (!easing) return;
    const timer = setTimeout(() => setEasing(false), 200);
    return () => clearTimeout(timer);
  }, [easing, turn]);
  const rotate = useCallback(
    (quarters: 1 | -1) => {
      setEasing(true);
      setTurn((value) => normalAngle(value + quarters * 90));
    },
    [setTurn],
  );
  useRotateGesture(
    stage,
    active && interactive && available,
    (degrees) => {
      twisting.current += degrees;
      setEasing(false);
      setTwist(twisting.current);
    },
    () => {
      const total = twisting.current;
      twisting.current = 0;
      setEasing(true);
      setTwist(0);
      setTurn((value) => nearestTurn(value + total));
    },
  );
  usePreviewKeys(
    stage,
    { 'Cmd+L': () => rotate(-1), 'Cmd+R': () => rotate(1) },
    active && interactive && available,
  );
  // A region small in the picture is zoomed to fill most of the stage, once per evidence; the
  // reader's own zoom and pan take over from there. Turned, the stage is turned with it.
  const zoomedFor = useRef<object | undefined>(undefined);
  useEffect(() => {
    const evidence = context.evidence;
    const element = stage.current;
    if (!region || !evidence || !element || imageSize.width <= 0 || zoomedFor.current === evidence)
      return;
    zoomedFor.current = evidence;
    const across = sideways(turn);
    const view = fitRegion(region, imageSize, {
      width: across ? element.clientHeight : element.clientWidth,
      height: across ? element.clientWidth : element.clientHeight,
    });
    setZoom(view.zoom / fit);
    setPan(turnPoint(view.pan, turn));
  }, [region, context.evidence, imageSize, setZoom, setPan, turn, fit]);
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
  // what Save rotated copy does, read when it runs: the host's callback is new each time it renders
  const copy = useRef(context.rotatedCopy);
  copy.current = context.rotatedCopy;
  const copies = !!context.rotatedCopy && transformableImage(resource.entry);
  const saveCopy = useCallback(() => {
    if (turn) copy.current?.(turn as QuarterTurn);
  }, [turn]);
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
        {
          id: 'image-rotate-left',
          label: 'Rotate left',
          aliases: ['turn left', 'counterclockwise', 'rotate view'],
          available,
          run: () => rotate(-1),
        },
        {
          id: 'image-rotate-right',
          label: 'Rotate right',
          aliases: ['turn right', 'clockwise', 'rotate view'],
          available,
          run: () => rotate(1),
        },
        ...(copies
          ? [
              {
                id: 'image-rotated-copy',
                label: 'Save rotated copy',
                aliases: ['rotated copy', 'keep rotation'],
                available: available && turn !== 0,
                run: saveCopy,
              },
            ]
          : []),
      ],
      [available, zoom, setPan, setZoom, rotate, copies, turn, saveCopy],
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
  const transform = `translate(${pan.x}px, ${pan.y}px) rotate(${angle}deg) scale(${zoom * fit})`;
  const transition = easing ? 'transform 150ms ease-out' : undefined;
  return (
    <div className="image-viewer">
      {large && (
        <p className="inline-warning">
          Large image · showing a bounded preview. Increase the image pixel limit in Settings to
          load the full image.
        </p>
      )}
      <PreviewToolbar context={context}>
        {context.toolbar !== 'essential' && context.optimize && optimizable(resource.entry) && (
          <button {...headerItem('optimize', 8, ['optimize-files'])} onClick={context.optimize}>
            Optimize…
          </button>
        )}
        {context.editImage && transformableImage(resource.entry) && (
          <button {...headerItem('image-tools', 5, ['image-tools'])} onClick={context.editImage}>
            Image tools…
          </button>
        )}
        <IconButton
          {...headerItem('fit', 3, ['preview.image-fit'])}
          icon="fit"
          label="Fit image"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        />
        <IconButton
          {...headerItem('zoom-out', 4, ['preview.zoom-out'])}
          icon="zoom-out"
          label="Zoom out"
          onClick={() => setZoom((value) => Math.max(0.1, value / 1.25))}
        />
        <span className="tabular" {...headerItem('zoom', 6, 'detail')}>
          {Math.round(zoom * 100)}%
        </span>
        <IconButton
          {...headerItem('zoom-in', 4, ['preview.zoom-in'])}
          icon="zoom-in"
          label="Zoom in"
          onClick={() => setZoom((value) => Math.min(20, value * 1.25))}
        />
        <IconButton
          {...headerItem('rotate-left', 5, ['preview.image-rotate-left'])}
          icon="rotate-left"
          label="Rotate left"
          title="Rotate left (⌘L)"
          onClick={() => rotate(-1)}
        />
        <IconButton
          {...headerItem('rotate-right', 5, ['preview.image-rotate-right'])}
          icon="rotate-right"
          label="Rotate right"
          title="Rotate right (⌘R)"
          onClick={() => rotate(1)}
        />
        {copies && turn !== 0 && (
          <button
            {...headerItem('rotated-copy', 6, ['preview.image-rotated-copy'])}
            title="Saves a turned copy beside the picture; the picture stays as it is."
            onClick={saveCopy}
          >
            Save rotated copy
          </button>
        )}
        <span className="toolbar-spacer" />
        <span className="muted" {...headerItem('size', 9, 'detail')}>
          {dimensions}
        </span>
      </PreviewToolbar>
      <div
        className="image-stage"
        ref={stage}
        data-turn={turn}
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
          onLoad={(event) => {
            const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
            setNatural({ width, height });
            setDimensions(`${width} × ${height}`);
          }}
          style={{ transform, transition }}
        />
        {region && imageSize.width > 0 && (
          <div
            className="image-evidence-overlay"
            style={{
              width: imageSize.width,
              height: imageSize.height,
              transform: `translate(-50%, -50%) ${transform}`,
              transition,
            }}
          >
            <EvidenceOverlay
              region={region.polygon ?? boxRegion(region)}
              label={region.polygon ? 'Outlined image region' : 'Referenced image region'}
            />
          </div>
        )}
      </div>
    </div>
  );
}
