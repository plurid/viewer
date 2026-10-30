import { useSyncExternalStore } from 'react';
import type { EvidenceRegion } from '../../domain/files/inspection';
import { regionPoints } from '../../domain/files/regions';
import { subscribeTour, tourAtRest } from '../workspace/tour';

/**
 * An outline over a page or picture. The SVG's `viewBox` is the unit square stretched over its
 * parent, so region points map straight onto it, and strokes keep their width at any size. In a
 * tour it draws in once the camera is at rest at its stop, where the eye can follow it.
 */
export function EvidenceOverlay({ region, label }: { region: EvidenceRegion; label: string }) {
  const rest = useSyncExternalStore(subscribeTour, tourAtRest);
  const points = regionPoints(region);
  return (
    <svg
      className="evidence-overlay"
      data-drawn={rest || undefined}
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
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
    </svg>
  );
}
