import { evidenceAnchorSchema, type EvidenceAnchor } from '../files/inspection';
import { regionFill, type Size } from '../files/regions';
import { describeAnchor, fileName } from './tour';

/** What the recorder measured on screen, which saved preview state does not hold. */
export interface PreviewMeasures {
  /** A picture's size at fit (zoom 1), and the stage it is shown in. */
  image?: { shown: Size; stage: Size };
  /** A drawing's canvas. */
  drawing?: Size;
}
type Values = Readonly<Record<string, unknown>>;
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const triple = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every(finite);
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** The previews whose saved state says where they are; `anchorFromPreviewState` reads it. */
const stateAnchoredModules = new Set(['pdf', 'image', 'dxf', 'model', 'media', 'epub']);
/**
 * Whether a preview's saved state alone places a stop. For these, a preview showing its file whole
 * records no anchor, even when it was opened at evidence: the person moved away from it.
 */
export const stateAnchored = (module: string) => stateAnchoredModules.has(module);
/**
 * An anchor for what a preview shows now, from its saved state: the PDF page and zoom, the part of
 * a picture or drawing in view, a model's camera, a media position or an EPUB chapter. A preview
 * showing its file whole, or a module with no such state, has none.
 */
export function anchorFromPreviewState(
  module: string,
  values: Values,
  measures: PreviewMeasures = {},
): EvidenceAnchor | undefined {
  const anchor = previewAnchor(module, values, measures);
  return anchor && evidenceAnchorSchema.safeParse(anchor).success ? anchor : undefined;
}
function previewAnchor(
  module: string,
  values: Values,
  measures: PreviewMeasures,
): EvidenceAnchor | undefined {
  if (module === 'pdf') {
    const page = values['pdf.page'],
      zoom = values['pdf.view'];
    if (!finite(page) || page < 1) return;
    return {
      kind: 'pdf',
      page: Math.floor(page),
      ...(zoom === 'page' || zoom === 'width' || (finite(zoom) && zoom >= 0.1 && zoom <= 4)
        ? { zoom }
        : {}),
    };
  }
  if (module === 'image') {
    const zoom = values['image.zoom'],
      pan = values['image.pan'] as { x?: unknown; y?: unknown } | undefined;
    const measured = measures.image;
    if (!finite(zoom) || !measured || zoom < 1.05) return;
    const x = finite(pan?.x) ? pan.x : 0,
      y = finite(pan?.y) ? pan.y : 0;
    const width = measured.shown.width * zoom,
      height = measured.shown.height * zoom;
    if (width <= 0 || height <= 0) return;
    // the stage's visible part, in the picture's unit coordinates
    const left = clamp(0.5 + (-measured.stage.width / 2 - x) / width),
      right = clamp(0.5 + (measured.stage.width / 2 - x) / width),
      top = clamp(0.5 + (-measured.stage.height / 2 - y) / height),
      bottom = clamp(0.5 + (measured.stage.height / 2 - y) / height);
    if (right <= left || bottom <= top) return;
    // Replaying zooms the region to fill `regionFill` of the view: record that share of it,
    // so the stop opens as it was framed.
    const shrink = (1 - regionFill) / 2;
    const box = {
      x: left + (right - left) * shrink,
      y: top + (bottom - top) * shrink,
      width: (right - left) * regionFill,
      height: (bottom - top) * regionFill,
    };
    return { kind: 'image', ...box };
  }
  if (module === 'dxf') {
    const view = values['dxf.view'] as
      { center?: { x?: unknown; y?: unknown }; scale?: unknown; fit?: unknown } | undefined;
    const size = measures.drawing;
    if (!view || view.fit || !finite(view.scale) || view.scale <= 0 || !size) return;
    const { x, y } = view.center ?? {};
    if (!finite(x) || !finite(y)) return;
    const half = { x: size.width / 2 / view.scale, y: size.height / 2 / view.scale };
    return {
      kind: 'dxf',
      entities: [],
      view: { min: [x - half.x, y - half.y], max: [x + half.x, y + half.y] },
    };
  }
  if (module === 'model') {
    const camera = values['model.camera'] as { position?: unknown; target?: unknown } | undefined;
    if (!triple(camera?.position) || !triple(camera.target)) return;
    return { kind: 'model', position: camera.position, target: camera.target };
  }
  if (module === 'media') {
    const seconds = values['media.position'];
    return finite(seconds) && seconds >= 1 ? { kind: 'media', seconds } : undefined;
  }
  if (module === 'epub') {
    const chapter = values['epub.chapter'];
    return finite(chapter) && chapter >= 1
      ? { kind: 'epub', chapter: Math.floor(chapter) }
      : undefined;
  }
}
/** A new stop's caption until the person writes one: its file and where in it. */
export function recordedCaption(path: string, anchor: EvidenceAnchor | undefined): string {
  return anchor ? `${fileName(path)}, ${describeAnchor(anchor)}` : fileName(path);
}
