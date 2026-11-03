import { createHash } from 'node:crypto';
import type { ExperimentDocument as CanvasDocument } from '../../domain/robotics/experiment-canvases';
import type { CanvasSource } from '../../domain/canvases/sources';
import { placementBriefSchema, placementStudySchema } from '../../domain/robotics/placement';
import type {
  PlacementStudy,
  PlacementReport,
  PlacementComparison,
} from '../../domain/robotics/placement';
import { checkPlacements } from '../robotics/placement';

export function placementInputHash(input: PlacementStudy): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        ...input,
        candidates: input.candidates.map((c) => ({
          ...c,
          poses: c.poses.map((p) => ({
            ...p,
            positions: Object.fromEntries(
              Object.entries(p.positions).sort(([a], [b]) => a.localeCompare(b)),
            ),
          })),
        })),
      }),
    )
    .digest('hex');
}
export function placementBrief(source: CanvasSource) {
  if (source.data.coverage.content !== 'complete')
    throw new Error('Attach the complete placement brief.');
  return placementBriefSchema.parse(JSON.parse(source.data.evidence.map((e) => e.text).join('\n')));
}
export function canvasPlacementReport(document: CanvasDocument): PlacementReport | undefined {
  const binding = document.placementCheck;
  if (!binding) return;
  const source = document.sources.find((s) => s.id === binding.sourceID);
  const brief = document.sources.find((s) => s.id === binding.briefSourceID);
  const input = placementStudySchema.safeParse(document.state[binding.stateKey]);
  if (
    binding.revision !== document.revision ||
    source?.hash !== binding.sourceHash ||
    brief?.hash !== binding.briefHash ||
    !source?.data.robot ||
    !input.success ||
    placementInputHash(input.data) !== binding.inputHash
  )
    return {
      status: 'stale',
      reason: 'The model, brief or saved study changed. Check the placements again.',
    };
  return checkPlacements(source.data.robot, placementBrief(brief), input.data);
}
export function comparePlacements(
  original: CanvasDocument,
  alternative: CanvasDocument,
): PlacementComparison {
  const unavailable = (reason: string): PlacementComparison => ({ status: 'unavailable', reason });
  if (alternative.fork?.id !== original.id)
    return unavailable('Compare a quoted alternative with its original.');
  const first = canvasPlacementReport(original),
    second = canvasPlacementReport(alternative);
  if (first?.status !== 'checked' || second?.status !== 'checked')
    return unavailable('Check both current placement studies.');
  if (
    original.placementCheck!.sourceHash !== alternative.placementCheck!.sourceHash ||
    original.placementCheck!.briefHash !== alternative.placementCheck!.briefHash ||
    JSON.stringify(first.input.reserved) !== JSON.stringify(second.input.reserved)
  )
    return unavailable('Use the same robot, brief and reserved mounting areas.');
  return {
    status: 'compared',
    original: { id: original.id, title: original.title, report: first },
    alternative: { id: alternative.id, title: alternative.title, report: second },
  };
}
