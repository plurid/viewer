import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePreviewState } from '../state';
import type { PreviewContext, QuarterTurn } from '../contracts';
import { PreviewToolbar, usePreviewCommands } from '../controls';
import { PreviewFailure } from '../PreviewFailure';
import { usePreviewKeys } from '../keys';
import {
  containedSize,
  normalAngle,
  savedTurn,
  sideways,
  turnPoint,
  turnedFit,
  useRotateGesture,
} from '../rotation';
import { headerItem } from '../../workspace/header-overflow';
import { IconButton, Loading } from '../../ui/primitives';
import { transformableImage } from '../../../domain/operations/image-conversions';
import { optimizable } from '../../../domain/operations/optimization';
import { boxRegion, fitRegion } from '../../../domain/files/regions';
import { shortcutFor, shortcutGlyphs, withShortcut } from '../../../domain/preferences/shortcuts';
import { EvidenceOverlay } from '../EvidenceOverlay';

/** The stage's margin around a fitted picture (previews.css, `.image-stage img`). */
const stageMargin = 40;
const zoomLimits = { least: 0.1, most: 20 };
const clampZoom = (value: number) => Math.max(zoomLimits.least, Math.min(zoomLimits.most, value));
/** Where a picture is drawn: its stage, less the margin around it. */
const roomOf = (stage: HTMLElement) => ({
  width: stage.clientWidth - stageMargin,
  height: stage.clientHeight - stageMargin,
});
/** Why Save Rotated Copy waits, said to a pointer, the keyboard and VoiceOver alike. */
const copyWaits = 'Turn the picture first, then save it turned.';

export default function ImagePreview(context: PreviewContext) {
  const { resource, active, interactive } = context;
  const [zoom, setZoom] = usePreviewState(context, 'image.zoom', 1);
  const [pan, setPan] = usePreviewState(context, 'image.pan', { x: 0, y: 0 });
  // the view's quarter turn, clockwise, remembered with the file's view; the picture never turns
  const [saved, setSaved] = usePreviewState<unknown>(context, 'image.turn', 0);
  const turn = savedTurn(saved);
  // The turn as drawn, counting whole turns: from 270 a quarter on is 360, not 0, so the
  // picture turns a quarter on rather than three back.
  const [spin, setSpin] = useState(turn);
  // how far two fingers have turned it on the trackpad, until they stop
  const [twist, setTwist] = useState(0);
  const twisting = useRef(0);
  // a quarter turn eases into place; a twist follows the fingers as they go
  const [easing, setEasing] = useState(false);
  const [loaded, setLoaded] = useState({ width: 0, height: 0 });
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
  const [room, setRoom] = useState({ width: 0, height: 0 });
  const region = context.evidence?.anchor.kind === 'image' ? context.evidence.anchor : undefined;
  useEffect(() => {
    const frame = stage.current;
    if (!frame) return;
    const resize = () => setRoom(roomOf(frame));
    const observer = new ResizeObserver(resize);
    observer.observe(frame);
    resize();
    return () => observer.disconnect();
  }, [available, resource.id]);
  const angle = spin + twist;
  // As the stylesheet lays it out, from its own size and the room, known with its first loaded
  // frame: measured after it is drawn, a remembered turn would be fitted one frame late.
  const shown = useMemo(() => containedSize(loaded, room), [loaded, room]);
  // Turned, the picture is drawn larger or smaller than the stylesheet lays it out, so that it
  // still fits the stage as a whole at zoom 1.
  const fit = turnedFit(shown, loaded, room, angle);
  // on its side, it waits unseen until it can be fitted, so it never shows at the wrong size
  const waiting = normalAngle(angle) % 180 !== 0 && shown.width <= 0;
  // the picture's own size: a large one shows a smaller copy, whose pixels are not the picture's
  const picture = resource.dimensions ?? loaded;
  // what the person sees, against the picture's own pixels: 100% is one pixel a point
  const scale =
    picture.width > 0 && shown.width > 0 ? (shown.width * fit * zoom) / picture.width : 0;
  useEffect(() => {
    if (!easing) return;
    const timer = setTimeout(() => setEasing(false), 200);
    return () => clearTimeout(timer);
  }, [easing, spin]);
  const rotate = useCallback(
    (quarters: 1 | -1) => {
      setEasing(true);
      setSpin((value) => value + quarters * 90);
      setSaved((value: unknown) => normalAngle(savedTurn(value) + quarters * 90));
    },
    [setSaved],
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
      setSpin((value) => Math.round((value + total) / 90) * 90);
      setSaved((value: unknown) => savedTurn(savedTurn(value) + total));
    },
  );
  // the keys and their hints follow the person's own shortcuts (Settings → Shortcuts)
  const left = shortcutFor(context.shortcuts, 'image-rotate-left');
  const right = shortcutFor(context.shortcuts, 'image-rotate-right');
  usePreviewKeys(
    stage,
    {
      ...(left ? { [left]: () => rotate(-1) } : {}),
      ...(right ? { [right]: () => rotate(1) } : {}),
    },
    active && interactive && available,
    context.commands?.header,
  );
  // A region small in the picture is zoomed to fill most of the stage, once per evidence; the
  // reader's own zoom and pan take over from there. Turned, the stage is turned with it.
  const zoomedFor = useRef<object | undefined>(undefined);
  useEffect(() => {
    const evidence = context.evidence;
    const element = stage.current;
    if (!region || !evidence || !element || shown.width <= 0 || zoomedFor.current === evidence)
      return;
    zoomedFor.current = evidence;
    const across = sideways(turn);
    const view = fitRegion(region, shown, {
      width: across ? element.clientHeight : element.clientWidth,
      height: across ? element.clientWidth : element.clientHeight,
    });
    setZoom(view.zoom / fit);
    setPan(turnPoint(view.pan, turn));
  }, [region, context.evidence, shown, setZoom, setPan, turn, fit]);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!active || !interactive) return;
      event.preventDefault();
      event.stopPropagation();
      setZoom((value) => clampZoom(value * Math.exp(-event.deltaY * 0.003)));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', wheel);
    };
  }, [active, interactive, available, setZoom]);
  // what Save Rotated Copy does, read when it runs: the host's callback is new each time it renders
  const copy = useRef(context.rotatedCopy);
  useLayoutEffect(() => {
    copy.current = context.rotatedCopy;
  });
  // the host offers it for a picture of its own a rotated copy can be made of
  const copies = !!context.rotatedCopy;
  const waitsWhy = useId();
  const saveCopy = useCallback(() => {
    if (turn) copy.current?.(turn as QuarterTurn);
  }, [turn]);
  const actualSize = useCallback(() => {
    if (!scale) return;
    setZoom((value) => clampZoom(value / scale));
    setPan({ x: 0, y: 0 });
  }, [scale, setZoom, setPan]);
  usePreviewCommands(
    context,
    useMemo(
      () => [
        {
          id: 'image-fit',
          label: 'Fit Image',
          aliases: ['fi'],
          primary: true,
          available,
          run: () => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          },
        },
        {
          id: 'image-actual-size',
          label: 'Actual Size',
          aliases: ['100%', 'one to one', 'pixels'],
          available: available && scale > 0,
          run: actualSize,
        },
        {
          id: 'zoom-in',
          label: 'Zoom In',
          available: available && zoom < zoomLimits.most,
          run: () => setZoom((value) => clampZoom(value * 1.25)),
        },
        {
          id: 'zoom-out',
          label: 'Zoom Out',
          available: available && zoom > zoomLimits.least,
          run: () => setZoom((value) => clampZoom(value / 1.25)),
        },
        {
          id: 'image-rotate-left',
          label: 'Rotate Left',
          aliases: ['turn left', 'counterclockwise', 'rotate view'],
          // the person's key, shown beside it in ⌘K and menus
          shortcut: shortcutGlyphs(left) || undefined,
          available,
          run: () => rotate(-1),
        },
        {
          id: 'image-rotate-right',
          label: 'Rotate Right',
          aliases: ['turn right', 'clockwise', 'rotate view'],
          shortcut: shortcutGlyphs(right) || undefined,
          available,
          run: () => rotate(1),
        },
        ...(copies
          ? [
              {
                id: 'image-rotated-copy',
                label: 'Save Rotated Copy',
                aliases: ['rotated copy', 'keep rotation'],
                available: available && turn !== 0,
                run: saveCopy,
              },
            ]
          : []),
      ],
      [
        available,
        zoom,
        scale,
        actualSize,
        setPan,
        setZoom,
        rotate,
        left,
        right,
        copies,
        turn,
        saveCopy,
      ],
    ),
  );
  if (byteLimited || thumbnailFailed || error)
    return (
      <PreviewFailure
        context={context}
        icon="image"
        title="Can’t show this image"
        detail={
          byteLimited
            ? 'It’s larger than 64 MB, the most a picture preview reads.'
            : thumbnailFailed
              ? 'Viewer couldn’t make a smaller copy of this image to show.'
              : 'It may be damaged, or saved in a format Viewer can’t read.'
        }
      />
    );
  if (large && !thumbnail) return <Loading label="Making a smaller copy to show…" />;
  const transform = `translate(${pan.x}px, ${pan.y}px) rotate(${angle}deg) scale(${zoom * fit})`;
  const transition = easing ? 'transform 150ms ease-out' : undefined;
  return (
    <div className="image-viewer">
      {large && (
        <p className="inline-warning">
          Showing a smaller copy of this large image. To see it at full size, raise Image pixel
          limit in Settings → Previews.
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
            Image Tools…
          </button>
        )}
        {/* Always here, so a turn changes no control's place. Until there is a turn to keep it
            waits, focusable, saying why to a pointer, the keyboard and VoiceOver. The rarest of
            the picture's actions, it is the first to show as its icon and the first to give way,
            so it never costs another action its label. In a plane's Essential header it waits in
            "…" with Optimize…. */}
        {copies && context.toolbar !== 'essential' && (
          <button
            {...headerItem('rotated-copy', 9, ['preview.image-rotated-copy'])}
            type="button"
            aria-disabled={turn ? undefined : true}
            aria-describedby={turn ? undefined : waitsWhy}
            title={turn ? undefined : copyWaits}
            onClick={saveCopy}
          >
            Save Rotated Copy
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
          onClick={() => setZoom((value) => clampZoom(value / 1.25))}
        />
        <span className="tabular preview-zoom-level" {...headerItem('zoom', 6, 'detail')}>
          {Math.round((scale || zoom) * 100)}%
        </span>
        <IconButton
          {...headerItem('zoom-in', 4, ['preview.zoom-in'])}
          icon="zoom-in"
          label="Zoom in"
          onClick={() => setZoom((value) => clampZoom(value * 1.25))}
        />
        <IconButton
          {...headerItem('rotate-left', 5, ['preview.image-rotate-left'])}
          icon="rotate-left"
          label="Rotate left"
          title={withShortcut('Rotate left', shortcutGlyphs(left))}
          onClick={() => rotate(-1)}
        />
        <IconButton
          {...headerItem('rotate-right', 5, ['preview.image-rotate-right'])}
          icon="rotate-right"
          label="Rotate right"
          title={withShortcut('Rotate right', shortcutGlyphs(right))}
          onClick={() => rotate(1)}
        />
        <span className="toolbar-spacer" />
        <span className="muted" {...headerItem('size', 9, 'detail')}>
          {picture.width > 0 ? `${picture.width} × ${picture.height}` : ''}
        </span>
      </PreviewToolbar>
      {copies && !turn && (
        <span id={waitsWhy} hidden>
          {copyWaits}
        </span>
      )}
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
          src={large ? thumbnail || undefined : resource.url}
          alt={resource.entry.name}
          draggable={false}
          onError={() => setError(true)}
          onLoad={(event) => {
            // the room and the picture's own size together, so its first frame is fitted
            if (stage.current) setRoom(roomOf(stage.current));
            setLoaded({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            });
          }}
          style={{ transform, transition, visibility: waiting ? 'hidden' : undefined }}
        />
        {region && shown.width > 0 && (
          <div
            className="image-evidence-overlay"
            style={{
              width: shown.width,
              height: shown.height,
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
