import type { RobotModel, RobotOrigin, RobotVector } from '../../domain/robotics/model';
import { robotTaskSchema } from '../../domain/robotics/task';
import type { RobotTask, RobotCheckReport } from '../../domain/robotics/task';

/** Independent point propagation, deliberately not using the solver's matrix implementation. */
function turn(point: RobotVector, axis: RobotVector, angle: number): RobotVector {
  const [x, y, z] = point,
    [u, v, w] = axis;
  const c = Math.cos(angle),
    s = Math.sin(angle),
    d = u * x + v * y + w * z;
  return [
    x * c + (v * z - w * y) * s + u * d * (1 - c),
    y * c + (w * x - u * z) * s + v * d * (1 - c),
    z * c + (u * y - v * x) * s + w * d * (1 - c),
  ];
}
function place(point: RobotVector, origin: RobotOrigin): RobotVector {
  let [x, y, z] = point;
  const [r, p, a] = origin.rpy;
  [y, z] = [Math.cos(r) * y - Math.sin(r) * z, Math.sin(r) * y + Math.cos(r) * z];
  [x, z] = [Math.cos(p) * x + Math.sin(p) * z, -Math.sin(p) * x + Math.cos(p) * z];
  [x, y] = [Math.cos(a) * x - Math.sin(a) * y, Math.sin(a) * x + Math.cos(a) * y];
  return [x + origin.xyz[0], y + origin.xyz[1], z + origin.xyz[2]];
}
export function checkRobotTask(
  model: RobotModel,
  value: RobotTask,
): Extract<RobotCheckReport, { status: 'checked' }> {
  const input = robotTaskSchema.parse(value);
  if (!model.links.some((link) => link.name === input.tool.link))
    throw new Error('Unknown tool link.');
  const moving = model.joints.filter((joint) => joint.type !== 'fixed');
  const parents = new Map(model.joints.map((joint) => [joint.child, joint]));
  const poses = input.poses.map((pose) => {
    if (
      Object.keys(pose.positions).length !== moving.length ||
      moving.some((joint) => !Object.hasOwn(pose.positions, joint.name))
    )
      throw new Error('Every candidate must supply exactly one position for every movable joint.');
    const violations = moving.flatMap((joint) => {
      const value = pose.positions[joint.name]!;
      return joint.limit && (value < joint.limit.lower || value > joint.limit.upper)
        ? [
            {
              joint: joint.name,
              value,
              ...joint.limit,
              unit: (joint.type === 'prismatic' ? 'm' : 'rad') as 'm' | 'rad',
            },
          ]
        : [];
    });
    let actual: RobotVector = [...input.tool.point];
    let link = input.tool.link;
    for (let count = 0; link !== model.root; count++) {
      const joint = parents.get(link);
      if (!joint || count >= 64) throw new Error('Invalid tool chain.');
      const value = joint.type === 'fixed' ? 0 : pose.positions[joint.name]!;
      if (joint.type === 'prismatic')
        actual = actual.map((v, i) => v + joint.axis[i]! * value) as RobotVector;
      else if (joint.type !== 'fixed') actual = turn(actual, joint.axis, value);
      actual = place(actual, joint.origin);
      link = joint.parent;
    }
    actual = place(actual, input.base);
    const target = input.targets.find((target) => target.id === pose.targetID)!;
    const residual = Math.hypot(...actual.map((v, i) => v - target.position[i]!));
    return {
      targetID: pose.targetID,
      actual,
      residual,
      withinTolerance: residual <= input.tolerance,
      violations,
    };
  });
  return {
    status: 'checked',
    passed: poses.every((pose) => pose.withinTolerance && !pose.violations.length),
    input,
    poses,
    scope: 'Endpoint positions and hard joint limits only',
    unchecked: 'Orientation, intervals between poses, collision, dynamics and hardware calibration',
  };
}
