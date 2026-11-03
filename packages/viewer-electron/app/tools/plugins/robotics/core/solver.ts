import type { RobotModel, RobotOrigin, RobotVector } from './model';
import { forwardKinematics, multiplyTransforms, originTransform } from './kinematics.js';
import type { RobotTransform } from './kinematics';

export interface PositionSolve {
  link: string;
  point: RobotVector;
  target: RobotVector;
  positions: Record<string, number>;
  base: RobotOrigin;
  tolerance: number;
}
export interface PositionSolution {
  outcome: 'candidate' | 'unresolved';
  positions: Record<string, number>;
  residual: number;
  iterations: number;
}
const pointAt = (matrix: RobotTransform, point: RobotVector): RobotVector =>
  [0, 1, 2].map(
    (row) =>
      matrix[12 + row]! +
      point.reduce((sum, value, column) => sum + value * matrix[column * 4 + row]!, 0),
  ) as RobotVector;
const norm = (v: number[]) => Math.hypot(...v);
const subtract = (a: RobotVector, b: RobotVector) => a.map((v, i) => v - b[i]!) as RobotVector;

function solve3(matrix: number[][], rhs: RobotVector): RobotVector {
  const rows = matrix.map((row, i) => [...row, rhs[i]!]);
  for (let column = 0; column < 3; column++) {
    let pivot = column;
    for (let row = column + 1; row < 3; row++)
      if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) pivot = row;
    [rows[column], rows[pivot]] = [rows[pivot]!, rows[column]!];
    const scale = rows[column]![column]!;
    if (Math.abs(scale) < 1e-15) return [0, 0, 0];
    for (let k = column; k < 4; k++) rows[column]![k]! /= scale;
    for (let row = 0; row < 3; row++)
      if (row !== column) {
        const factor = rows[row]![column]!;
        for (let k = column; k < 4; k++) rows[row]![k]! -= factor * rows[column]![k]!;
      }
  }
  return rows.map((row) => row[3]!) as RobotVector;
}

/** Bounded damped least squares. A failed search is unresolved, not proof of unreachability. */
export async function solvePosition(
  model: RobotModel,
  input: PositionSolve,
  signal?: AbortSignal,
): Promise<PositionSolution> {
  input = {
    ...input,
    positions: { ...input.positions },
    target: [...input.target],
    point: [...input.point],
    base: { xyz: [...input.base.xyz], rpy: [...input.base.rpy] },
  };
  originTransform({ xyz: input.target, rpy: input.point });
  if (!Number.isFinite(input.tolerance) || input.tolerance < 1e-6 || input.tolerance > 0.005)
    throw new Error('Position tolerance must be between 0.000001 and 0.005 metres.');
  if (!model.links.some((link) => link.name === input.link)) throw new Error('Unknown tool link.');
  const first = forwardKinematics(model, input.positions, input.base);
  const byChild = new Map(model.joints.map((joint) => [joint.child, joint]));
  const chain = [];
  let link = input.link;
  while (link !== model.root) {
    const joint = byChild.get(link);
    if (!joint || chain.length >= 64) throw new Error('Invalid tool chain.');
    chain.push(joint);
    link = joint.parent;
  }
  const active = chain.filter((joint) => joint.type !== 'fixed');
  if (active.length > 16)
    throw new Error('Target solving supports at most 16 moving joints in a chain.');
  let best: PositionSolution = {
    outcome: 'unresolved',
    positions: { ...input.positions },
    residual: norm(subtract(input.target, pointAt(first.links[input.link]!, input.point))),
    iterations: 0,
  };
  const bounds = active.map((joint) => joint.limit ?? { lower: -Math.PI, upper: Math.PI });
  const project = (value: number, index: number) =>
    Math.max(bounds[index]!.lower, Math.min(bounds[index]!.upper, value));
  let bestValid = first.violations.length === 0;
  // Fixed caps and cooperative yielding keep impossible requests responsive in the iframe.
  for (let attempt = 0; attempt < 6; attempt++) {
    const positions = { ...input.positions };
    active.forEach((joint, index) => {
      const { lower, upper } = bounds[index]!;
      const fraction = attempt === 1 ? 0.5 : (attempt * (index + 1) * 0.61803398875) % 1;
      positions[joint.name] =
        attempt === 0 ? project(positions[joint.name]!, index) : lower + fraction * (upper - lower);
    });
    for (let step = 0; step < 96; step++) {
      signal?.throwIfAborted();
      if (step % 8 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      signal?.throwIfAborted();
      best.iterations++;
      const pose = forwardKinematics(model, positions, input.base);
      const tip = pointAt(pose.links[input.link]!, input.point);
      const error = subtract(input.target, tip);
      const distance = norm(error);
      const valid = pose.violations.length === 0;
      if ((valid && !bestValid) || (valid === bestValid && distance <= best.residual)) {
        best = { ...best, positions: { ...positions }, residual: distance };
        bestValid = valid;
      }
      if (valid && distance <= input.tolerance) return { ...best, outcome: 'candidate' };
      if (!active.length) break;
      const jacobian = active.map((joint) => {
        const frame = multiplyTransforms(pose.links[joint.parent]!, originTransform(joint.origin));
        const axis = [0, 1, 2].map((row) =>
          joint.axis.reduce((sum, value, column) => sum + value * frame[column * 4 + row]!, 0),
        ) as RobotVector;
        if (joint.type === 'prismatic') return axis;
        const delta = subtract(tip, frame.slice(12, 15) as RobotVector);
        return [
          axis[1] * delta[2] - axis[2] * delta[1],
          axis[2] * delta[0] - axis[0] * delta[2],
          axis[0] * delta[1] - axis[1] * delta[0],
        ];
      });
      const normal = [0, 1, 2].map((row) =>
        [0, 1, 2].map(
          (col) =>
            jacobian.reduce((sum, j) => sum + j[row]! * j[col]!, 0) + (row === col ? 0.0004 : 0),
        ),
      );
      const direction = solve3(normal, error);
      const delta = jacobian.map((j, i) => {
        const cap = active[i]!.type === 'prismatic' ? 0.05 : 0.3;
        return Math.max(
          -cap,
          Math.min(
            cap,
            j.reduce((sum, v, k) => sum + v * direction[k]!, 0),
          ),
        );
      });
      let improved = false;
      for (const factor of [1, 0.5, 0.25, 0.125]) {
        const next = { ...positions };
        active.forEach((joint, index) => {
          next[joint.name] = project(positions[joint.name]! + factor * delta[index]!, index);
        });
        const test = forwardKinematics(model, next, input.base);
        if (
          norm(subtract(input.target, pointAt(test.links[input.link]!, input.point))) <
          distance - 1e-12
        ) {
          Object.assign(positions, next);
          improved = true;
          break;
        }
      }
      if (!improved) break;
    }
  }
  return best;
}
