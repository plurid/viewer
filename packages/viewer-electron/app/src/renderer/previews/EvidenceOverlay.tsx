import { useSyncExternalStore } from 'react';
import type { EvidenceMark, EvidenceRegion } from '../../domain/files/inspection';
import { regionPoints } from '../../domain/files/regions';
import { subscribeTour, tourAtRest } from '../workspace/tour';

/**
 * Outlines over a page or picture: the region a stop is about and its marks, such as the text a
 * value is read from, drawn thinner and dashed. The SVG's `viewBox` is the unit square stretched
 * over its parent, so region points map straight onto it, and strokes keep their width at any
 * size. In a tour they draw in once the camera is at rest at its stop, where the eye can follow.
 */
export function EvidenceOverlay({
  region,
  marks = [],
  label,
}: {
  region?: EvidenceRegion;
  marks?: readonly EvidenceMark[];
  label: string;
}) {
  const rest = useSyncExternalStore(subscribeTour, tourAtRest);
  const outlines = [...(region ? [{ kind: 'feature' as const, region }] : []), ...marks];
  return (
    <svg
      className="evidence-overlay"
      data-drawn={rest || undefined}
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      {outlines.map((outline, index) => {
        const points = regionPoints(outline.region);
        return (
          <g key={index} data-kind={outline.kind}>
            <polygon
              className="evidence-overlay-halo"
              points={points}
              vectorEffect="non-scaling-stroke"
            />
            <polygon
              className="evidence-overlay-line"
              points={points}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
    </svg>
  );
}
