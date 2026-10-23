/** A plane on screen: its pane, and where it is drawn. */
export interface VisiblePlane {
  paneID: string;
  rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>;
}
/**
 * The planes the person can see (2026-10-23): drawn, not set aside by a docked plane, not culled
 * away, at least 24px each way and overlapping the space. Found by the pane id their content
 * carries, so a plane without a header counts too.
 */
export function visiblePlanes(): VisiblePlane[] {
  const bounds = document.querySelector('.workspace-surface')?.getBoundingClientRect();
  return Array.from(document.querySelectorAll<HTMLElement>('[data-viewer-pane]')).flatMap(
    (marker) => {
      const plane = marker.closest<HTMLElement>('[data-plurid-plane]');
      const culled = plane?.dataset.pluridCulled;
      if (
        !plane ||
        plane.dataset.pluridAside === 'true' ||
        culled === 'hidden' ||
        culled === 'detached'
      )
        return [];
      const rect = plane.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 24) return [];
      if (
        bounds &&
        (rect.right < bounds.left ||
          rect.left > bounds.right ||
          rect.bottom < bounds.top ||
          rect.top > bounds.bottom)
      )
        return [];
      return [{ paneID: marker.dataset.viewerPane ?? '', rect }];
    },
  );
}
const centre = ({ rect }: VisiblePlane) => ({
  x: rect.left + rect.width / 2,
  y: rect.top + rect.height / 2,
});
export type PlaneDirection = 'left' | 'right' | 'up' | 'down';
/**
 * The plane next to `from` in a direction, as tmux's pane keys: the nearest whose centre lies that
 * way, a plane in line preferred over one at a slant.
 */
export function nearestPlane(
  planes: readonly VisiblePlane[],
  from: string,
  direction: PlaneDirection,
): string | undefined {
  const start = planes.find((plane) => plane.paneID === from);
  if (!start) return planes[0]?.paneID;
  const origin = centre(start);
  let best: { id: string; score: number } | undefined;
  for (const plane of planes) {
    if (plane.paneID === from) continue;
    const point = centre(plane);
    const along =
      direction === 'left'
        ? origin.x - point.x
        : direction === 'right'
          ? point.x - origin.x
          : direction === 'up'
            ? origin.y - point.y
            : point.y - origin.y;
    if (along <= 4) continue;
    const across =
      direction === 'left' || direction === 'right'
        ? Math.abs(point.y - origin.y)
        : Math.abs(point.x - origin.x);
    const score = along + across * 2;
    if (!best || score < best.score) best = { id: plane.paneID, score };
  }
  return best?.id;
}
/** Planes in reading order: rows top to bottom (40px apart counts as one row), then left to right. */
export const readingOrder = (planes: readonly VisiblePlane[]) =>
  [...planes].sort(
    (a, b) =>
      Math.round(a.rect.top / 40) - Math.round(b.rect.top / 40) || a.rect.left - b.rect.left,
  );
/** The plane after `from` in reading order, wrapping. */
export function nextPlane(planes: readonly VisiblePlane[], from: string): string | undefined {
  const ordered = readingOrder(planes);
  const index = ordered.findIndex((plane) => plane.paneID === from);
  return ordered[(index + 1) % ordered.length]?.paneID;
}
/** Home row first, as Vimium: one letter each while they last, then two. */
const alphabet = 'asdfghjklqwertyuiopzxcvbnm';
export function hintLabels(count: number): string[] {
  if (count <= alphabet.length) return [...alphabet.slice(0, count)];
  const labels: string[] = [];
  for (const first of alphabet)
    for (const second of alphabet) {
      if (labels.length === count) return labels;
      labels.push(first + second);
    }
  return labels;
}
