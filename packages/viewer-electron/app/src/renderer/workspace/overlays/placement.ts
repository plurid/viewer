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
