export const overviewInset = 16;
export const overviewClearance = 8;
export const overviewCorners = ['top-right', 'bottom-left', 'top-left', 'bottom-right'] as const;

export type OverviewCorner = (typeof overviewCorners)[number];

export interface OverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type OverviewPlacement =
  { kind: 'corner'; corner: OverviewCorner; bounds: OverlayRect } | { kind: 'fallback' };

export function validOverlayRect(rect: OverlayRect): boolean {
  return (
    [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function intersects(a: OverlayRect, b: OverlayRect): boolean {
  return (
    a.x < b.x + b.width + overviewClearance &&
    a.x + a.width > b.x - overviewClearance &&
    a.y < b.y + b.height + overviewClearance &&
    a.y + a.height > b.y - overviewClearance
  );
}

/** A control panel may sit along an edge between protected bands, rather than cover a footer. */
export function solveProtectedOverlayPlacement({
  viewport,
  bounds,
  obstacles,
}: {
  viewport: OverlayRect;
  bounds: OverlayRect;
  obstacles: readonly OverlayRect[];
}): OverlayRect | undefined {
  if (
    !validOverlayRect(viewport) ||
    !validOverlayRect(bounds) ||
    bounds.width + overviewInset * 2 > viewport.width ||
    bounds.height + overviewInset * 2 > viewport.height
  )
    return;

  const left = viewport.x + overviewInset;
  const top = viewport.y + overviewInset;
  const right = viewport.x + viewport.width - overviewInset - bounds.width;
  const bottom = viewport.y + viewport.height - overviewInset - bounds.height;
  const protectedAreas = obstacles.filter(validOverlayRect);
  const clampX = (value: number) => Math.max(left, Math.min(right, value));
  const clampY = (value: number) => Math.max(top, Math.min(bottom, value));
  const preferred = { ...bounds, x: clampX(bounds.x), y: clampY(bounds.y) };
  const safe = (candidate: OverlayRect) =>
    !protectedAreas.some((obstacle) => intersects(candidate, obstacle));
  if (safe(preferred)) return preferred;

  // At most eight candidates per obstacle, without a cross-product grid or idle polling.
  const horizontal = [left, right];
  const vertical = [top, bottom];
  const candidates: OverlayRect[] = [];
  const addHorizontal = (y: number) => {
    for (const x of horizontal) candidates.push({ ...bounds, x, y: clampY(y) });
  };
  const addVertical = (x: number) => {
    for (const y of vertical) candidates.push({ ...bounds, x: clampX(x), y });
  };
  for (const y of vertical) addHorizontal(y);
  for (const obstacle of protectedAreas) {
    addHorizontal(obstacle.y - overviewClearance - bounds.height);
    addHorizontal(obstacle.y + obstacle.height + overviewClearance);
    addVertical(obstacle.x - overviewClearance - bounds.width);
    addVertical(obstacle.x + obstacle.width + overviewClearance);
  }
  const distance = (candidate: OverlayRect) =>
    (candidate.x - preferred.x) ** 2 + (candidate.y - preferred.y) ** 2;
  return candidates.filter(safe).sort((a, b) => distance(a) - distance(b))[0];
}

/** Pure geometry: preserving a valid corner avoids jitter as the camera moves. */
export function solveOverviewPlacement({
  viewport,
  size,
  obstacles,
  current,
}: {
  viewport: OverlayRect;
  size: { width: number; height: number };
  obstacles: readonly OverlayRect[];
  current?: OverviewCorner;
}): OverviewPlacement {
  if (
    !validOverlayRect(viewport) ||
    !validOverlayRect({ x: 0, y: 0, ...size }) ||
    size.width + overviewInset * 2 > viewport.width ||
    size.height + overviewInset * 2 > viewport.height
  )
    return { kind: 'fallback' };
  const candidates = current
    ? [current, ...overviewCorners.filter((corner) => corner !== current)]
    : overviewCorners;
  for (const corner of candidates) {
    const bounds = {
      x: corner.endsWith('right')
        ? viewport.x + viewport.width - overviewInset - size.width
        : viewport.x + overviewInset,
      y: corner.startsWith('bottom')
        ? viewport.y + viewport.height - overviewInset - size.height
        : viewport.y + overviewInset,
      ...size,
    };
    if (!obstacles.some((obstacle) => validOverlayRect(obstacle) && intersects(bounds, obstacle)))
      return { kind: 'corner', corner, bounds };
  }
  return { kind: 'fallback' };
}
