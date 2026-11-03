import type { RobotModel, RobotOrigin, RobotVector } from './model';

/** Column-major rigid transform, directly usable by Three Matrix4.fromArray. */
export type RobotTransform = number[];
export interface RobotPose {
  links: Record<string, RobotTransform>;
  violations: { joint: string; value: number; lower: number; upper: number; unit: 'm' | 'rad' }[];
}
const identity = (): RobotTransform => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function multiplyTransforms(a: RobotTransform, b: RobotTransform): RobotTransform {
  const result = Array<number>(16).fill(0);
  for (let column = 0; column < 4; column++)
    for (let row = 0; row < 4; row++)
      for (let k = 0; k < 4; k++) result[column * 4 + row]! += a[k * 4 + row]! * b[column * 4 + k]!;
  return result;
}
function rotation([x, y, z]: RobotVector, angle: number): RobotTransform {
  const c = Math.cos(angle),
    s = Math.sin(angle),
    t = 1 - c;
  return [
    t * x * x + c,
    t * x * y + s * z,
    t * x * z - s * y,
    0,
    t * x * y - s * z,
    t * y * y + c,
    t * y * z + s * x,
    0,
    t * x * z + s * y,
    t * y * z - s * x,
    t * z * z + c,
    0,
    0,
    0,
    0,
    1,
  ];
}
function finiteVector(value: RobotVector) {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e6)
  )
    throw new Error('Robot coordinates must be three finite values within the supported range.');
}
export function originTransform(origin: RobotOrigin): RobotTransform {
  finiteVector(origin.xyz);
  finiteVector(origin.rpy);
  // URDF fixed-axis roll/pitch/yaw is Rz(yaw) Ry(pitch) Rx(roll).
  const result = multiplyTransforms(
    multiplyTransforms(rotation([0, 0, 1], origin.rpy[2]), rotation([0, 1, 0], origin.rpy[1])),
    rotation([1, 0, 0], origin.rpy[0]),
  );
  result.splice(12, 3, ...origin.xyz);
  return result;
}

/** All movable joints are explicit. Out-of-limit inputs are reported, never silently clamped. */
export function forwardKinematics(
  model: RobotModel,
  positions: Record<string, number>,
  base: RobotOrigin = { xyz: [0, 0, 0], rpy: [0, 0, 0] },
): RobotPose {
  const movable = new Set(
    model.joints.filter((joint) => joint.type !== 'fixed').map((joint) => joint.name),
  );
  if (
    !positions ||
    Array.isArray(positions) ||
    typeof positions !== 'object' ||
    Object.keys(positions).some((name) => !movable.has(name)) ||
    [...movable].some(
      (name) =>
        !Object.hasOwn(positions, name) ||
        !Number.isFinite(positions[name]) ||
        Math.abs(positions[name]!) > 1e6,
    )
  )
    throw new Error('Supply exactly one finite position for every movable joint.');
  const links: RobotPose['links'] = Object.create(null);
  links[model.root] = originTransform(base);
  const violations: RobotPose['violations'] = [];
  let remaining = [...model.joints];
  while (remaining.length) {
    const next = remaining.filter((joint) => {
      const parent = links[joint.parent];
      if (!parent) return true;
      const value = joint.type === 'fixed' ? 0 : positions[joint.name]!;
      if (joint.limit && (value < joint.limit.lower || value > joint.limit.upper))
        violations.push({
          joint: joint.name,
          value,
          ...joint.limit,
          unit: joint.type === 'prismatic' ? 'm' : 'rad',
        });
      let motion = identity();
      if (joint.type === 'prismatic')
        motion.splice(12, 3, ...joint.axis.map((axis) => axis * value));
      else if (joint.type !== 'fixed') motion = rotation(joint.axis, value);
      links[joint.child] = multiplyTransforms(
        multiplyTransforms(parent, originTransform(joint.origin)),
        motion,
      );
      return false;
    });
    if (next.length === remaining.length)
      throw new Error('Robot joints do not form a connected tree.');
    remaining = next;
  }
  return { links, violations };
}
