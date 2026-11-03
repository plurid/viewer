import { parseRobotURDF } from './core/urdf';
import { forwardKinematics, originTransform, multiplyTransforms } from './core/kinematics';
import { solvePosition } from './core/solver';
import { checkRobotTask } from './core/check';
import { checkPlacements } from './core/placement-check';
import { placementBriefSchema } from './core/placement';
import type { RobotVector } from './core/model';
import type { PlacementBrief, PlacementStudy } from './core/placement';

export { forwardKinematics, originTransform, multiplyTransforms, solvePosition, parseRobotURDF };

export const reservedArea = { min: [0.14, 0.12], max: [0.26, 0.24] } as const;
export interface PoseProbe {
  mount: string;
  joints: string;
  targetX: number;
  targetY: number;
  targetZ: number;
  tolerance: number;
  limitJoint?: string;
  limitLower?: number;
  limitUpper?: number;
}

/** The plugin owns these calculations. Its host only supplies raw snapshots and action execution. */
export function createWorkbench(xml: string, rawBrief: unknown) {
  const robot = parseRobotURDF(xml);
  const brief = placementBriefSchema.parse(rawBrief);
  const zero = Object.fromEntries(
    robot.joints.filter((joint) => joint.type !== 'fixed').map((joint) => [joint.name, 0]),
  );
  const shifted = (offset: number): PlacementBrief => {
    if (!Number.isFinite(offset)) throw new Error('Target offset must be finite.');
    return {
      ...brief,
      targets: brief.targets.map((target) => ({
        ...target,
        position: [target.position[0] + offset, target.position[1], target.position[2]],
      })),
    };
  };
  const check = (candidates: PlacementStudy['candidates'], reserved: boolean, offset: number) => {
    const report = checkPlacements(robot, shifted(offset), {
      version: 1,
      reserved: reserved ? [{ min: [...reservedArea.min], max: [...reservedArea.max] }] : [],
      candidates: candidates.map(({ id, poses }) => ({
        id,
        poses: poses.map(({ targetID, positions }) => ({ targetID, positions })),
      })),
    });
    return {
      candidates: report.candidates.map((candidate) => ({
        id: candidate.id,
        poses: candidate.poses.map((pose) => ({
          ...pose,
          positions: candidates
            .find((item) => item.id === candidate.id)!
            .poses.find((item) => item.targetID === pose.targetID)!.positions,
          violations: pose.violations.map((violation) => violation.joint),
        })),
        eligible: candidate.passed,
        movement: candidate.distance,
      })),
      recommended: report.recommended ?? null,
    };
  };
  const inspectPose = (input: PoseProbe) => {
    const model = structuredClone(robot);
    if (input.limitJoint) {
      const joint = model.joints.find((item) => item.name === input.limitJoint);
      if (!joint?.limit) throw new Error('Choose a bounded joint for the limit override.');
      joint.limit = {
        lower: input.limitLower ?? joint.limit.lower,
        upper: input.limitUpper ?? joint.limit.upper,
      };
      if (joint.limit.lower > joint.limit.upper) throw new Error('Joint limits are reversed.');
    }
    const mount = brief.mounts.find((item) => item.id === input.mount);
    if (!mount) throw new Error('Unknown mounting point.');
    const pose = checkRobotTask(model, {
      version: 1,
      units: brief.units,
      tool: brief.tool,
      base: mount.base,
      tolerance: input.tolerance,
      targets: [{ id: 'probe', position: [input.targetX, input.targetY, input.targetZ] }],
      poses: [{ targetID: 'probe', positions: JSON.parse(input.joints) }],
    }).poses[0]!;
    return { ...pose, violations: pose.violations.map((violation) => violation.joint) };
  };
  return {
    robot,
    brief,
    zero,
    check,
    inspectPose,
    async evaluate(
      input: { reserved: boolean; targetOffsetX: number },
      signal?: AbortSignal,
      progress: (label: string) => void = () => {},
    ) {
      const task = shifted(input.targetOffsetX);
      const candidates: PlacementStudy['candidates'] = [];
      for (const mount of task.mounts) {
        const poses: PlacementStudy['candidates'][number]['poses'] = [];
        for (const target of task.targets) {
          signal?.throwIfAborted();
          progress(mount.label + ' · ' + target.id);
          const solved = await solvePosition(
            robot,
            {
              ...task.tool,
              base: mount.base,
              target: target.position,
              tolerance: task.tolerance,
              positions: zero,
            },
            signal,
          );
          poses.push({ targetID: target.id, positions: solved.positions });
        }
        candidates.push({ id: mount.id, poses });
      }
      return check(candidates, input.reserved, input.targetOffsetX);
    },
    selfTest() {
      const translated = originTransform({ xyz: [0.1, 0.2, 0.3], rpy: [0, 0, 0] });
      const rotated = originTransform({ xyz: [0, 0, 0], rpy: [0, 0, Math.PI / 2] });
      const positions = Object.fromEntries(
        robot.joints
          .filter((joint) => joint.type !== 'fixed')
          .map((joint) => [
            joint.name,
            joint.limit ? (joint.limit.lower + joint.limit.upper) / 2 : 0,
          ]),
      );
      const mount = brief.mounts[0]!;
      const matrix = forwardKinematics(robot, positions, mount.base).links[brief.tool.link]!;
      const actual = [0, 1, 2].map(
        (row) =>
          matrix[12 + row]! +
          brief.tool.point.reduce((sum, value, col) => sum + value * matrix[col * 4 + row]!, 0),
      ) as RobotVector;
      const probe = {
        mount: mount.id,
        joints: JSON.stringify(positions),
        targetX: actual[0],
        targetY: actual[1],
        targetZ: actual[2],
        tolerance: brief.tolerance,
      };
      const tested = inspectPose(probe);
      const joint = robot.joints.find((item) => item.limit)!;
      const limit = inspectPose({
        ...probe,
        limitJoint: joint.name,
        limitLower: positions[joint.name]! + 0.01,
        limitUpper: positions[joint.name]! + 0.02,
      });
      const tests = [
        {
          name: 'Translation preserves XYZ',
          passed: translated
            .slice(12, 15)
            .every((v, i) => Math.abs(v - [0.1, 0.2, 0.3][i]!) < 1e-12),
        },
        {
          name: 'Quarter turn rotates X onto Y',
          passed: Math.abs(rotated[0]!) < 1e-12 && Math.abs(rotated[1]! - 1) < 1e-12,
        },
        {
          name: 'Point propagation agrees with matrix kinematics',
          passed: tested.residual < 1e-12,
        },
        {
          name: 'Limit override rejects the same pose',
          passed: limit.violations.includes(joint.name),
        },
      ];
      return { passed: tests.every((test) => test.passed), tests };
    },
  };
}
