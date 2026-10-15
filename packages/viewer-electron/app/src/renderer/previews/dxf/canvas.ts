import { measureLocalPoint } from '../../ui/projectedResize';
import { distance, type Drawing, type DrawingEntity, type Point } from '../../../domain/dxf/math';
import {
  convertUnits,
  formatMeasure,
  measurementValue,
  type Measurement,
  type Tool,
} from '../../../domain/dxf/units';

export interface DrawingView {
  center: Point;
  scale: number;
  fit?: boolean;
}
export interface CanvasOptions {
  active: boolean;
  interactive: boolean;
  look: 'dark' | 'light';
  tool: Tool;
  grid: boolean;
  snap: boolean;
  hiddenLayers: readonly string[];
  measurements: Measurement[];
  unit: number;
  displayUnit: number;
}
interface Callbacks {
  selected(entity: DrawingEntity | undefined): void;
  measurements(items: Measurement[]): void;
  draft(count: number): void;
  view(value: DrawingView): void;
}
export interface DrawingCanvas {
  set(options: CanvasOptions): void;
  frame(): void;
  finish(): void;
  cancel(): void;
  dispose(): void;
}
function segmentDistance(p: Point, a: Point, b: Point): number {
  const length = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = length
    ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length))
    : 0;
  return distance(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}
const intersects = (entity: DrawingEntity, p: Point, tolerance: number) =>
  p.x >= entity.bounds.min.x - tolerance &&
  p.x <= entity.bounds.max.x + tolerance &&
  p.y >= entity.bounds.min.y - tolerance &&
  p.y <= entity.bounds.max.y + tolerance;

/** Draw only when dirty. Pointer feedback and camera movement never publish React state. */
export function createDrawingCanvas(
  stage: HTMLElement,
  canvas: HTMLCanvasElement,
  drawing: Drawing,
  initial: CanvasOptions,
  callbacks: Callbacks,
  savedView?: DrawingView,
): DrawingCanvas {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas graphics are unavailable.');
  let options = initial,
    hidden = new Set(initial.hiddenLayers),
    width = 1,
    height = 1,
    raf = 0,
    disposed = false;
  let view = savedView ?? { center: { x: 0, y: 0 }, scale: 1 },
    fitted = !!savedView;
  let selected: DrawingEntity | undefined,
    draft: Point[] = [],
    hover: Point | undefined,
    snapped: { point: Point; kind: string } | undefined;
  let local = measureLocalPoint(stage);
  let drag:
    { id: number; start: Point; center: Point; panning: boolean; moved: boolean } | undefined;
  let nextMeasurement = Math.max(0, ...initial.measurements.map((m) => m.id)) + 1;
  let palette: { background: string; ink: string; accent: string; muted: string; line: string };
  let paletteDirty = true;
  let readoutBounds: { x: number; y: number; width: number; height: number } | undefined;
  const paths = new Map(
    drawing.entities.map((entity) => {
      const path = new Path2D();
      entity.points.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)));
      if (entity.closed) path.closePath();
      return [entity.id, path];
    }),
  );
  const extent = Math.max(
    drawing.bounds.max.x - drawing.bounds.min.x,
    drawing.bounds.max.y - drawing.bounds.min.y,
    1,
  );
  const cellSize = extent / 128;
  const snaps = new Map<string, { point: Point; kind: string; layer: string }[]>();
  const cell = (p: Point) => `${Math.floor(p.x / cellSize)},${Math.floor(p.y / cellSize)}`;
  for (const entity of drawing.entities)
    for (const snap of entity.snaps) {
      const key = cell(snap.point),
        bucket = snaps.get(key) ?? [];
      bucket.push({ ...snap, layer: entity.layer });
      snaps.set(key, bucket);
    }
  function colors() {
    const style = getComputedStyle(canvas);
    palette = {
      background: style.getPropertyValue('--field').trim(),
      ink: style.getPropertyValue('--ink').trim(),
      accent: style.getPropertyValue('--accent').trim(),
      muted: style.getPropertyValue('--muted').trim(),
      line: style.getPropertyValue('--line').trim(),
    };
  }
  const screen = (p: Point): Point => ({
    x: (p.x - view.center.x) * view.scale + width / 2,
    y: height / 2 - (p.y - view.center.y) * view.scale,
  });
  const world = (p: Point): Point => ({
    x: (p.x - width / 2) / view.scale + view.center.x,
    y: (height / 2 - p.y) / view.scale + view.center.y,
  });
  function schedule() {
    if (!disposed && options.active && !raf) raf = requestAnimationFrame(render);
  }
  function frame() {
    const visible = drawing.entities.filter((e) => !hidden.has(e.layer));
    if (!visible.length) return;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const e of visible) {
      minX = Math.min(minX, e.bounds.min.x);
      minY = Math.min(minY, e.bounds.min.y);
      maxX = Math.max(maxX, e.bounds.max.x);
      maxY = Math.max(maxY, e.bounds.max.y);
    }
    view = {
      fit: true,
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      scale: Math.max(
        1e-9,
        Math.min(
          Math.max(1, width - 80) / Math.max(1e-6, maxX - minX),
          Math.max(1, height - 80) / Math.max(1e-6, maxY - minY),
        ),
      ),
    };
    fitted = true;
    callbacks.view(view);
    schedule();
  }
  function pickSnap(p: Point): { point: Point; kind: string } | undefined {
    if (!options.snap) return;
    const tolerance = 12 / view.scale,
      cellRadius = Math.ceil(tolerance / cellSize);
    // At extreme zoom-out use a bounded linear scan instead of visiting millions of empty cells.
    const candidates = cellRadius > 16 ? [...snaps.values()].flat() : [];
    if (cellRadius <= 16)
      for (
        let x = Math.floor(p.x / cellSize) - cellRadius;
        x <= Math.floor(p.x / cellSize) + cellRadius;
        x++
      )
        for (
          let y = Math.floor(p.y / cellSize) - cellRadius;
          y <= Math.floor(p.y / cellSize) + cellRadius;
          y++
        )
          candidates.push(...(snaps.get(`${x},${y}`) ?? []));
    let best: { point: Point; kind: string } | undefined,
      bestDistance = tolerance;
    for (const candidate of candidates) {
      if (hidden.has(candidate.layer)) continue;
      const delta = distance(p, candidate.point);
      if (delta < bestDistance) {
        bestDistance = delta;
        best = candidate;
      }
    }
    return best;
  }
  function pickEntity(p: Point): DrawingEntity | undefined {
    let result: DrawingEntity | undefined,
      best = 8 / view.scale;
    for (const entity of drawing.entities) {
      if (hidden.has(entity.layer) || !intersects(entity, p, best)) continue;
      if (entity.text || entity.points.length === 1) {
        const delta = distance(p, entity.points[0]);
        if (delta < best) {
          best = delta;
          result = entity;
        }
        continue;
      }
      for (let i = 1; i < entity.points.length; i++) {
        const delta = segmentDistance(p, entity.points[i - 1], entity.points[i]);
        if (delta < best) {
          best = delta;
          result = entity;
        }
      }
    }
    return result;
  }
  function polyline(points: Point[], close = false) {
    ctx!.beginPath();
    points.forEach((p, i) => {
      const s = screen(p);
      if (i) ctx!.lineTo(s.x, s.y);
      else ctx!.moveTo(s.x, s.y);
    });
    if (close) ctx!.closePath();
    ctx!.stroke();
  }
  function label(value: string, p: Point) {
    const s = screen(p);
    ctx!.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
    const w = ctx!.measureText(value).width + 12;
    let x = Math.max(4, Math.min(width - w - 4, s.x + 10)),
      y = Math.max(18, Math.min(height - 8, s.y - 10));
    if (
      readoutBounds &&
      x - 4 < readoutBounds.x + readoutBounds.width &&
      x - 4 + w > readoutBounds.x &&
      y - 14 < readoutBounds.y + readoutBounds.height &&
      y + 6 > readoutBounds.y
    ) {
      const right = readoutBounds.x + readoutBounds.width + 8;
      if (right + w <= width - 4) x = right;
      else y = Math.min(height - 8, readoutBounds.y + readoutBounds.height + 22);
    }
    ctx!.fillStyle = palette.background;
    ctx!.fillRect(x - 4, y - 14, w, 20);
    ctx!.fillStyle = palette.accent;
    ctx!.fillText(value, x + 2, y);
  }
  function measurement(measure: Measurement, preview = false) {
    ctx!.strokeStyle = palette.accent;
    ctx!.lineWidth = preview ? 1 : 1.5;
    ctx!.setLineDash(preview ? [4, 4] : []);
    polyline(measure.points, measure.tool === 'area');
    for (const point of measure.points) {
      const p = screen(point);
      ctx!.beginPath();
      ctx!.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx!.stroke();
    }
    const value = measurementValue(measure);
    if (value !== undefined)
      label(
        measure.tool === 'angle'
          ? `${value.toFixed(2)}°`
          : formatMeasure(
              convertUnits(value, options.unit, options.displayUnit, measure.tool === 'area'),
              options.displayUnit,
              measure.tool === 'area',
            ),
        measure.points[measure.points.length - 1],
      );
    ctx!.setLineDash([]);
  }
  function render() {
    raf = 0;
    if (disposed || !options.active) return;
    // Parent theme effects apply the root tokens after the preview's effect. Sample at paint.
    if (paletteDirty) {
      colors();
      paletteDirty = false;
    }
    const readout = stage.querySelector<HTMLElement>('.dxf-readout');
    readoutBounds = readout
      ? {
          x: readout.offsetLeft,
          y: readout.offsetTop,
          width: readout.offsetWidth,
          height: readout.offsetHeight,
        }
      : undefined;
    const dpr = Math.min(devicePixelRatio, 2);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.fillStyle = palette.background;
    ctx!.fillRect(0, 0, width, height);
    const bounds = { min: world({ x: 0, y: height }), max: world({ x: width, y: 0 }) };
    if (options.grid) {
      const raw = 60 / view.scale,
        base = 10 ** Math.floor(Math.log10(raw)),
        ratio = raw / base;
      const step = base * (ratio > 5 ? 10 : ratio > 2 ? 5 : ratio > 1 ? 2 : 1);
      ctx!.strokeStyle = palette.line;
      ctx!.globalAlpha = 0.4;
      ctx!.lineWidth = 0.5;
      ctx!.beginPath();
      for (let x = Math.ceil(bounds.min.x / step) * step; x <= bounds.max.x; x += step) {
        const p = screen({ x, y: 0 });
        ctx!.moveTo(p.x, 0);
        ctx!.lineTo(p.x, height);
      }
      for (let y = Math.ceil(bounds.min.y / step) * step; y <= bounds.max.y; y += step) {
        const p = screen({ x: 0, y });
        ctx!.moveTo(0, p.y);
        ctx!.lineTo(width, p.y);
      }
      ctx!.stroke();
      ctx!.globalAlpha = 1;
    }
    ctx!.save();
    ctx!.translate(width / 2, height / 2);
    ctx!.scale(view.scale, -view.scale);
    ctx!.translate(-view.center.x, -view.center.y);
    for (const entity of drawing.entities) {
      if (
        hidden.has(entity.layer) ||
        entity.bounds.max.x < bounds.min.x ||
        entity.bounds.min.x > bounds.max.x ||
        entity.bounds.max.y < bounds.min.y ||
        entity.bounds.min.y > bounds.max.y
      )
        continue;
      const color = entity.color;
      ctx!.strokeStyle =
        selected === entity
          ? palette.accent
          : !color || ['#ffffff', '#000000'].includes(color.toLowerCase())
            ? palette.ink
            : color;
      ctx!.lineWidth = (selected === entity ? 2.5 : 1.25) / view.scale;
      if (entity.text) {
        ctx!.save();
        ctx!.translate(entity.points[0].x, entity.points[0].y);
        ctx!.rotate(entity.text.rotation);
        ctx!.scale(1, -1);
        ctx!.fillStyle = ctx!.strokeStyle;
        ctx!.font = `${entity.text.height}px sans-serif`;
        entity.text.value
          .split('\n')
          .forEach((line, i) => ctx!.fillText(line, 0, i * entity.text!.height * 1.25));
        ctx!.restore();
      } else if (entity.points.length === 1) {
        const p = entity.points[0],
          size = 3 / view.scale;
        ctx!.beginPath();
        ctx!.moveTo(p.x - size, p.y);
        ctx!.lineTo(p.x + size, p.y);
        ctx!.moveTo(p.x, p.y - size);
        ctx!.lineTo(p.x, p.y + size);
        ctx!.stroke();
      } else ctx!.stroke(paths.get(entity.id)!);
    }
    ctx!.restore();
    for (const item of options.measurements) measurement(item);
    const preview = draft.length && hover ? [...draft, hover] : draft;
    if (options.tool !== 'inspect' && preview.length >= (options.tool === 'angle' ? 3 : 2))
      measurement({ id: 0, tool: options.tool, points: preview }, true);
    else if (draft.length) {
      ctx!.strokeStyle = palette.accent;
      polyline(preview);
    }
    if (snapped) {
      const p = screen(snapped.point);
      ctx!.strokeStyle = palette.accent;
      ctx!.lineWidth = 1.5;
      ctx!.strokeRect(p.x - 5, p.y - 5, 10, 10);
      label(snapped.kind, snapped.point);
    }
    // Scale bar always uses drawing coordinates, independently of Plurid's camera scale.
    const target = 100 / view.scale,
      base = 10 ** Math.floor(Math.log10(target)),
      ratio = target / base;
    const length = base * (ratio >= 5 ? 5 : ratio >= 2 ? 2 : 1),
      bar = length * view.scale;
    ctx!.strokeStyle = palette.muted;
    ctx!.lineWidth = 1;
    ctx!.beginPath();
    ctx!.moveTo(16, height - 30);
    ctx!.lineTo(16 + bar, height - 30);
    ctx!.moveTo(16, height - 34);
    ctx!.lineTo(16, height - 26);
    ctx!.moveTo(16 + bar, height - 34);
    ctx!.lineTo(16 + bar, height - 26);
    ctx!.stroke();
    ctx!.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx!.fillStyle = palette.muted;
    ctx!.fillText(
      formatMeasure(convertUnits(length, options.unit, options.displayUnit), options.displayUnit),
      16,
      height - 10,
    );
  }
  function cancel() {
    draft = [];
    hover = undefined;
    snapped = undefined;
    callbacks.draft(0);
    schedule();
  }
  function finish() {
    if (options.tool !== 'area' || draft.length < 3) return;
    commit('area', draft);
    cancel();
  }
  function commit(tool: Measurement['tool'], points: Point[]) {
    if (options.measurements.length >= 100) return;
    const item = { id: nextMeasurement++, tool, points: [...points] };
    if (measurementValue(item) === undefined || (tool === 'area' && measurementValue(item) === 0))
      return;
    options = { ...options, measurements: [...options.measurements, item] };
    callbacks.measurements(options.measurements);
    schedule();
  }
  const canInteract = () => options.active && options.interactive;
  function point(event: PointerEvent | WheelEvent): Point | undefined {
    return local({ x: event.clientX, y: event.clientY });
  }
  const enter = () => {
    local = measureLocalPoint(stage);
  };
  const down = (event: PointerEvent) => {
    if (!canInteract() || ![0, 1, 2].includes(event.button)) return;
    event.preventDefault();
    event.stopPropagation();
    local = measureLocalPoint(stage);
    const p = point(event);
    if (!p) return;
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    drag = {
      id: event.pointerId,
      start: p,
      center: { ...view.center },
      panning: event.button !== 0 || event.altKey,
      moved: false,
    };
  };
  const move = (event: PointerEvent) => {
    if (!canInteract()) return;
    event.stopPropagation();
    const p = point(event);
    if (!p) return;
    if (drag?.id === event.pointerId) {
      if (distance(p, drag.start) > 3) {
        drag.moved = true;
        drag.panning = true;
      }
      if (drag.panning) {
        view = {
          ...view,
          fit: false,
          center: {
            x: drag.center.x - (p.x - drag.start.x) / view.scale,
            y: drag.center.y + (p.y - drag.start.y) / view.scale,
          },
        };
        hover = undefined;
        snapped = undefined;
        schedule();
        return;
      }
    }
    const cursor = world(p);
    snapped = event.shiftKey ? undefined : pickSnap(cursor);
    hover = snapped?.point ?? cursor;
    schedule();
  };
  const up = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) return;
    event.stopPropagation();
    const p = point(event),
      clicked = !drag.moved && !drag.panning;
    drag = undefined;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    callbacks.view(view);
    if (!canInteract() || !clicked || !p) return;
    const cursor = world(p),
      snap = event.shiftKey ? undefined : pickSnap(cursor),
      value = snap?.point ?? cursor;
    if (options.tool === 'inspect') {
      selected = pickEntity(cursor);
      callbacks.selected(selected);
      schedule();
      return;
    }
    if (draft.length && distance(draft[draft.length - 1], value) < 1e-9) return;
    if (
      options.tool === 'area' &&
      draft.length >= 3 &&
      distance(screen(draft[0]), screen(value)) <= 12
    ) {
      finish();
      return;
    }
    if (draft.length >= 200) return;
    draft = [...draft, value];
    callbacks.draft(draft.length);
    if (
      (options.tool === 'distance' && draft.length === 2) ||
      (options.tool === 'angle' && draft.length === 3)
    ) {
      commit(options.tool, draft);
      cancel();
    }
    schedule();
  };
  const leave = () => {
    if (!drag) {
      hover = undefined;
      snapped = undefined;
      schedule();
    }
  };
  const lost = () => {
    drag = undefined;
  };
  const wheel = (event: WheelEvent) => {
    if (!canInteract()) return;
    event.preventDefault();
    event.stopPropagation();
    local = measureLocalPoint(stage);
    const p = point(event);
    if (!p) return;
    const anchor = world(p),
      scale = Math.max(
        1e-9,
        Math.min(1e9, view.scale * Math.exp(-Math.max(-200, Math.min(200, event.deltaY)) * 0.0015)),
      );
    view = {
      fit: false,
      center: { x: anchor.x - (p.x - width / 2) / scale, y: anchor.y + (p.y - height / 2) / scale },
      scale,
    };
    callbacks.view(view);
    schedule();
  };
  const key = (event: KeyboardEvent) => {
    if (!canInteract()) return;
    // A focused drawing owns its keys; Shift/arrows must not rotate the space.
    if (
      [
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Enter',
        'Escape',
        'Backspace',
        'Delete',
        'Home',
      ].includes(event.key)
    ) {
      event.stopPropagation();
      event.preventDefault();
      if (event.key === 'Escape') cancel();
      else if (event.key === 'Enter') finish();
      else if (event.key === 'Home') frame();
      else if (['Backspace', 'Delete'].includes(event.key)) {
        draft = draft.slice(0, -1);
        callbacks.draft(draft.length);
        schedule();
      } else {
        const dx = event.key === 'ArrowLeft' ? -40 : event.key === 'ArrowRight' ? 40 : 0,
          dy = event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0;
        view = {
          ...view,
          fit: false,
          center: { x: view.center.x + dx / view.scale, y: view.center.y + dy / view.scale },
        };
        callbacks.view(view);
        schedule();
      }
    }
  };
  const context = (event: Event) => {
    if (canInteract()) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const dblclick = (event: MouseEvent) => {
    if (canInteract()) {
      event.preventDefault();
      event.stopPropagation();
      if (options.tool === 'area') finish();
      else if (options.tool === 'inspect') frame();
    }
  };
  canvas.addEventListener('pointerenter', enter);
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('lostpointercapture', lost);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('keydown', key);
  canvas.addEventListener('contextmenu', context);
  canvas.addEventListener('dblclick', dblclick);
  const resize = new ResizeObserver(() => {
    width = Math.max(1, stage.clientWidth);
    height = Math.max(1, stage.clientHeight);
    const dpr = Math.min(devicePixelRatio, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    local = measureLocalPoint(stage);
    if (!fitted || view.fit) frame();
    schedule();
  });
  resize.observe(stage);
  return {
    frame,
    finish,
    cancel,
    set(next) {
      if (options.tool !== next.tool) cancel();
      if (options.look !== next.look) paletteDirty = true;
      options = next;
      hidden = new Set(next.hiddenLayers);
      if (selected && hidden.has(selected.layer)) {
        selected = undefined;
        callbacks.selected(undefined);
      }
      canvas.style.cursor = options.tool === 'inspect' ? 'grab' : 'crosshair';
      if (!options.active) {
        cancelAnimationFrame(raf);
        raf = 0;
        drag = undefined;
      } else schedule();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      resize.disconnect();
      paths.clear();
      snaps.clear();
      canvas.removeEventListener('pointerenter', enter);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('lostpointercapture', lost);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('keydown', key);
      canvas.removeEventListener('contextmenu', context);
      canvas.removeEventListener('dblclick', dblclick);
      canvas.width = 1;
      canvas.height = 1;
    },
  };
}
