export interface Point {
  x: number;
  y: number;
}

/** Invert a projected rectangle: spatial scale, rotation and perspective all affect a drag. */
export function projectedLocalX(
  [p0, p1, p2, p3]: readonly [Point, Point, Point, Point],
  width: number,
): (point: Point) => number | undefined {
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  const divisor = dx1 * dy2 - dx2 * dy1;
  const affine = Math.abs(dx3) + Math.abs(dy3) < 1e-8;
  if (!affine && Math.abs(divisor) < 1e-8) return () => undefined;
  const g = affine ? 0 : (dx3 * dy2 - dx2 * dy3) / divisor;
  const h = affine ? 0 : (dx1 * dy3 - dx3 * dy1) / divisor;
  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + h * p3.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + h * p3.y;
  return ({ x, y }) => {
    const ax = a - x * g;
    const bx = b - x * h;
    const dy = d - y * g;
    const ey = e - y * h;
    const determinant = ax * ey - bx * dy;
    if (Math.abs(determinant) < 1e-8) return;
    const result = (((x - p0.x) * ey - bx * (y - p0.y)) / determinant) * width;
    return Number.isFinite(result) ? result : undefined;
  };
}

/** Measure once per drag, never during pointer movement or ordinary sidebar rendering. */
export function measureLocalX(element: HTMLElement): (point: Point) => number | undefined {
  const local = measureLocalPoint(element);
  return (point) => local(point)?.x;
}

/** Canvas tools use both coordinates; measure at gesture start, not each move. */
export function measureLocalPoint(element: HTMLElement): (point: Point) => Point | undefined {
  const probes = ['0,0', '100,0', '100,100', '0,100'].map((corner) => {
    const [left, top] = corner.split(',');
    const probe = document.createElement('span');
    probe.style.cssText = `position:absolute;left:${left}%;top:${top}%;width:0;height:0;pointer-events:none;visibility:hidden`;
    probe.setAttribute('aria-hidden', 'true');
    return probe;
  });
  element.append(...probes);
  const points = probes.map((probe) => {
    const { left: x, top: y } = probe.getBoundingClientRect();
    return { x, y };
  }) as [Point, Point, Point, Point];
  const width = element.clientWidth;
  const height = element.clientHeight;
  for (const probe of probes) probe.remove();
  const x = projectedLocalX(points, width);
  const y = projectedLocalX([points[0], points[3], points[2], points[1]], height);
  return (point) => {
    const localX = x(point),
      localY = y(point);
    return localX === undefined || localY === undefined ? undefined : { x: localX, y: localY };
  };
}
