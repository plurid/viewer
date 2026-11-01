import type { RobotModel } from './model';
import type { RobotTask } from './task';
import { forwardKinematics } from './kinematics.js';

/** Visual interpolation only. The caller owns its clock; sampled poses never replace saved inputs. */
export function createPoseReplay(model: RobotModel, input: RobotTask['poses']) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 16)
    throw new Error('Replay needs between 1 and 16 poses.');
  const poses = input.map((pose) => {
    forwardKinematics(model, pose.positions);
    return { targetID: pose.targetID, positions: { ...pose.positions } };
  });
  if (poses.some((pose) => typeof pose.targetID !== 'string' || !pose.targetID.length))
    throw new Error('Every replay pose needs a target name.');
  return {
    length: poses.length,
    sample(cursor: number) {
      if (!Number.isFinite(cursor) || cursor < 0 || cursor > poses.length - 1)
        throw new Error('Replay position must be within the saved pose sequence.');
      const index = Math.floor(cursor);
      const from = poses[index]!;
      const to = poses[Math.min(index + 1, poses.length - 1)]!;
      const fraction = cursor - index;
      // Preserve explicit revolutions and limit violations. A shortest-angle path would hide them.
      const positions = Object.fromEntries(
        Object.entries(from.positions).map(([joint, value]) => [
          joint,
          fraction === 0 ? value : value + (to.positions[joint]! - value) * fraction,
        ]),
      );
      return { from: from.targetID, to: to.targetID, fraction, positions };
    },
  };
}
