import { placementBriefSchema, placementStudySchema } from '../../domain/robotics/placement';
import type {
  PlacementBrief,
  PlacementReport,
  PlacementStudy,
} from '../../domain/robotics/placement';
import type { RobotModel } from '../../domain/robotics/model';
import { checkRobotTask } from './check';

export function checkPlacements(
  robot: RobotModel,
  briefValue: PlacementBrief,
  value: PlacementStudy,
): Extract<PlacementReport, { status: 'checked' }> {
  const brief = placementBriefSchema.parse(briefValue);
  const input = placementStudySchema.parse(value);
  if (
    new Set(input.candidates.map((c) => c.id)).size !== brief.mounts.length ||
    input.candidates.length !== brief.mounts.length ||
    brief.mounts.some((m) => !input.candidates.some((c) => c.id === m.id)) ||
    (input.selected && !brief.mounts.some((m) => m.id === input.selected))
  )
    throw new Error('Supply the exact mounting positions from the brief.');
  const contains = (area: PlacementBrief['bench'], point: number[]) =>
    area.min.every((v, i) => point[i]! >= v && point[i]! <= area.max[i]!);
  const candidates = brief.mounts.map((mount) => {
    const candidate = input.candidates.find((c) => c.id === mount.id)!;
    const checked = checkRobotTask(robot, {
      version: 1,
      units: brief.units,
      tool: brief.tool,
      tolerance: brief.tolerance,
      targets: brief.targets,
      base: mount.base,
      poses: candidate.poses,
    });
    const allowed =
      contains(brief.bench, mount.base.xyz) &&
      !input.reserved.some((area) => contains(area, mount.base.xyz));
    return {
      id: mount.id,
      label: mount.label,
      allowed,
      passed: allowed && checked.passed,
      reached: checked.poses.filter((p) => p.withinTolerance && !p.violations.length).length,
      total: brief.targets.length,
      maximumError: Math.max(...checked.poses.map((p) => p.residual)),
      distance: Math.hypot(...mount.base.xyz.map((v, i) => v - brief.reference[i]!)),
      poses: checked.poses,
    };
  });
  const preferred = candidates
    .filter((c) => c.passed)
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))[0];
  return {
    status: 'checked',
    brief,
    input,
    candidates,
    recommended: preferred?.id,
    scope:
      'Endpoint positions, hard joint limits and mounting points only. Orientation, swept volume, collision, clamp fit and hardware operation are not checked.',
  };
}
