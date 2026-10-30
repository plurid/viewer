import type { EvidenceRegion } from './inspection';

/** A box in unit coordinates of a page or picture, from its top-left corner. */
export interface UnitBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Size {
  width: number;
  height: number;
}
/** How a picture is shown: scaled about its centre, then moved by `pan` in screen pixels. */
export interface RegionView {
  zoom: number;
  pan: { x: number; y: number };
}
/** The share of the view a region fills once Viewer zooms to it. */
export const regionFill = 0.6;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** The outline as SVG `points` in a 0 to 1 `viewBox`, each point clamped to the page. */
export function regionPoints(region: EvidenceRegion): string {
  return region
    .map(([x, y]) => `${Number(clamp(x).toFixed(5))},${Number(clamp(y).toFixed(5))}`)
    .join(' ');
}
export function regionBounds(region: EvidenceRegion): UnitBox {
  const xs = region.map(([x]) => clamp(x)),
    ys = region.map(([, y]) => clamp(y));
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
/** A box's corners as an outline, for a region recorded as a rectangle. */
export function boxRegion(box: UnitBox): EvidenceRegion {
  const right = clamp(box.x + box.width),
    bottom = clamp(box.y + box.height);
  return [
    [clamp(box.x), clamp(box.y)],
    [right, clamp(box.y)],
    [right, bottom],
    [clamp(box.x), bottom],
  ];
}
/**
 * The zoom and pan that centre `box` on a picture shown at `shown` size in a `view`, filling about
 * `regionFill` of it. A region already that large keeps the picture fitted: zooming never shrinks
 * it below its fitted size, nor past `maxZoom`.
 */
export function fitRegion(box: UnitBox, shown: Size, view: Size, maxZoom = 20): RegionView {
  if (shown.width <= 0 || shown.height <= 0 || view.width <= 0 || view.height <= 0)
    return { zoom: 1, pan: { x: 0, y: 0 } };
  const width = Math.max(box.width * shown.width, 1),
    height = Math.max(box.height * shown.height, 1);
  const zoom = Math.max(
    1,
    Math.min(maxZoom, (view.width * regionFill) / width, (view.height * regionFill) / height),
  );
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  return {
    zoom,
    pan: {
      x: -(centre.x - 0.5) * shown.width * zoom,
      y: -(centre.y - 0.5) * shown.height * zoom,
    },
  };
}
/**
 * The scale at which `box` of a page `page` pixels large at scale 1 fills about `regionFill` of
 * `available`, between `fitted` (the whole page) and `maxScale`.
 */
export function regionScale(
  box: UnitBox,
  page: Size,
  available: Size,
  fitted: number,
  maxScale = 4,
): number {
  if (page.width <= 0 || page.height <= 0 || available.width <= 0 || available.height <= 0)
    return fitted;
  const scale = Math.min(
    (available.width * regionFill) / Math.max(box.width * page.width, 1),
    (available.height * regionFill) / Math.max(box.height * page.height, 1),
  );
  return Math.round(Math.max(fitted, Math.min(maxScale, scale)) * 100) / 100;
}
