/** Offline test equipment. Never bundled into Viewer or supplied to the generated plugin. */
import assert from 'node:assert/strict';
import { z } from 'zod';
import type { CanvasActionInput } from '../../src/domain/canvases/actions';
import type { RobotModel, RobotVector } from '../../src/domain/robotics/model';
import { forwardKinematics } from '../../src/domain/robotics/kinematics';
import { placementBriefSchema } from '../../src/domain/robotics/placement';
import type { PlacementBrief } from '../../src/domain/robotics/placement';
import { parseRobotURDF } from '../../src/domain/robotics/urdf';
import { stationPoseResultSchema, stationStudySchema } from './station-contract';
import type { StationStudy } from './station-contract';

export type StationInvoke = (action: string, input: CanvasActionInput) => Promise<unknown>;
const near = (actual: number, expected: number, label: string) =>
  assert.ok(Math.abs(actual - expected) <= 1e-6, `${label}: ${actual} != ${expected}`);
const sameIDs = (actual: string[], expected: string[], label: string) =>
  assert.deepEqual([...actual].sort(), [...expected].sort(), label);

function referencePose(
  model: RobotModel,
  brief: PlacementBrief,
  mount: string,
  positions: Record<string, number>,
) {
  const base = brief.mounts.find((item) => item.id === mount);
  assert.ok(base, 'Unknown mount: ' + mount);
  const pose = forwardKinematics(model, positions, base.base);
  const matrix = pose.links[brief.tool.link];
  assert.ok(matrix, 'Missing tool link');
  const [x, y, z] = brief.tool.point;
  const actual: RobotVector = [0, 1, 2].map(
    (row) => matrix[row]! * x + matrix[row + 4]! * y + matrix[row + 8]! * z + matrix[row + 12]!,
  ) as RobotVector;
  return { actual, violations: pose.violations.map((item) => item.joint) };
}

function verifyPose(
  raw: unknown,
  expected: ReturnType<typeof referencePose>,
  target: RobotVector,
  tolerance: number,
) {
  const result = stationPoseResultSchema.parse(raw);
  result.actual.forEach((value, index) => near(value, expected.actual[index]!, 'World position'));
  const residual = Math.hypot(...expected.actual.map((value, index) => value - target[index]!));
  near(result.residual, residual, 'Endpoint residual');
  assert.equal(result.withinTolerance, residual <= tolerance, 'Endpoint tolerance result');
  sameIDs(result.violations, expected.violations, 'Joint limit violations');
  return result;
}

function verifyStudy(
  raw: unknown,
  model: RobotModel,
  brief: PlacementBrief,
  reserved: boolean,
  offset: number,
): StationStudy {
  const study = stationStudySchema.parse(raw);
  sameIDs(
    study.candidates.map((item) => item.id),
    brief.mounts.map((item) => item.id),
    'All mounts',
  );
  for (const candidate of study.candidates) {
    const mount = brief.mounts.find((item) => item.id === candidate.id)!;
    sameIDs(
      candidate.poses.map((pose) => pose.targetID),
      brief.targets.map((t) => t.id),
      'All targets',
    );
    let reached = true;
    for (const pose of candidate.poses) {
      const target = brief.targets.find((item) => item.id === pose.targetID)!.position;
      const result = verifyPose(
        pose,
        referencePose(model, brief, mount.id, pose.positions),
        [target[0] + offset, target[1], target[2]],
        brief.tolerance,
      );
      reached &&= result.withinTolerance && !result.violations.length;
    }
    const [x, y] = mount.base.xyz;
    const onBench = [x, y].every((v, i) => v >= brief.bench.min[i]! && v <= brief.bench.max[i]!);
    const excluded = reserved && x >= 0.14 && x <= 0.26 && y >= 0.12 && y <= 0.24;
    assert.equal(
      candidate.eligible,
      reached && onBench && !excluded,
      'Mount eligibility: ' + mount.id,
    );
    near(
      candidate.movement,
      Math.hypot(...mount.base.xyz.map((v, i) => v - brief.reference[i]!)),
      'Base movement',
    );
  }
  const passing = study.candidates
    .filter((item) => item.eligible)
    .sort((a, b) => a.movement - b.movement);
  assert.equal(
    study.recommended,
    passing[0]?.id ?? null,
    'Recommendation from verified returned poses',
  );
  return study;
}

export async function reviewStationPlugin(
  invoke: StationInvoke,
  urdf: string,
  rawBrief: unknown,
  reserved: boolean,
) {
  const model = parseRobotURDF(urdf);
  const brief = placementBriefSchema.parse(rawBrief);
  const checks: string[] = [];
  const selfTest = z
    .object({
      passed: z.literal(true),
      tests: z.array(z.object({ name: z.string().min(1), passed: z.literal(true) })).min(3),
    })
    .parse(await invoke('selfTest', {}));
  checks.push('Plugin self-tests reported passing; independently tested below');
  const movable = model.joints.filter((joint) => joint.type !== 'fixed');
  for (const [sample, fraction] of [0.25, 0.53, 0.78].entries()) {
    const positions = Object.fromEntries(
      movable.map((joint, index) => [
        joint.name,
        joint.limit
          ? joint.limit.lower +
            (joint.limit.upper - joint.limit.lower) * (index % 2 ? 1 - fraction : fraction)
          : fraction,
      ]),
    );
    const mount = brief.mounts[sample % brief.mounts.length]!.id;
    const expected = referencePose(model, brief, mount, positions);
    const input = {
      mount,
      joints: JSON.stringify(positions),
      targetX: expected.actual[0],
      targetY: expected.actual[1],
      targetZ: expected.actual[2],
      tolerance: brief.tolerance,
    };
    verifyPose(await invoke('inspectPose', input), expected, expected.actual, brief.tolerance);
    // Move only the target: a checker that ignores its inputs must fail this probe.
    verifyPose(
      await invoke('inspectPose', { ...input, targetX: input.targetX + 0.017 }),
      expected,
      [input.targetX + 0.017, input.targetY, input.targetZ],
      brief.tolerance,
    );
    const joint = movable.find((item) => item.limit);
    assert.ok(joint, 'The fixture needs a bounded joint');
    const value = positions[joint.name]!;
    verifyPose(
      await invoke('inspectPose', {
        ...input,
        limitJoint: joint.name,
        limitLower: value + 0.01,
        limitUpper: value + 0.1,
      }),
      { ...expected, violations: [...new Set([...expected.violations, joint.name])] },
      expected.actual,
      brief.tolerance,
    );
  }
  checks.push('Three held-out poses agree with external forward kinematics within 1 micrometre');
  checks.push('Moved targets and tightened joint limits change the plugin checker results');
  const baseline = verifyStudy(
    await invoke('evaluate', { reserved, targetOffsetX: 0 }),
    model,
    brief,
    reserved,
    0,
  );
  assert.equal(
    baseline.recommended,
    reserved ? 'front' : 'central',
    'The demo task must be solved',
  );
  checks.push('All 24 returned poses, limits, movements and recommendation checked externally');
  let perturbed: StationStudy;
  try {
    perturbed = verifyStudy(
      await invoke('evaluate', { reserved, targetOffsetX: 0.013 }),
      model,
      brief,
      reserved,
      0.013,
    );
    assert.ok(
      perturbed.candidates.some((candidate) => candidate.eligible),
      'Solve the perturbed targets too',
    );
    checks.push('A 13 mm target change is solved and independently remeasured');
  } finally {
    // Preserve the rehearsed inputs after testing the solver on an unshown target change.
    await invoke('evaluate', { reserved, targetOffsetX: 0 });
  }
  return { status: 'passed' as const, checks, selfTest, baseline, perturbed };
}
