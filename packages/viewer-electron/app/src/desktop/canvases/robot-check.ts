import { createHash } from 'node:crypto';
import type { CanvasDocument } from '../../domain/canvases/document';
import { robotTaskSchema } from '../../domain/robotics/task';
import type { RobotTask, RobotCheckReport } from '../../domain/robotics/task';
import { checkRobotTask } from '../robotics/check';

export function robotInputHash(input: RobotTask): string {
  const canonical = {
    ...input,
    poses: input.poses.map((pose) => ({
      ...pose,
      positions: Object.fromEntries(
        Object.entries(pose.positions).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      ),
    })),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
export function canvasRobotReport(document: CanvasDocument): RobotCheckReport | undefined {
  const binding = document.robotCheck;
  if (!binding) return;
  const source = document.sources.find((source) => source.id === binding.sourceID);
  const input = robotTaskSchema.safeParse(document.state[binding.stateKey]);
  if (
    binding.revision !== document.revision ||
    source?.hash !== binding.sourceHash ||
    !source?.data.robot ||
    !input.success ||
    robotInputHash(input.data) !== binding.inputHash
  )
    return {
      status: 'stale',
      reason: 'The model, workbench or saved task changed. Check the current poses again.',
    };
  // Restart and imported bindings never inherit a trusted success flag.
  return checkRobotTask(source.data.robot, input.data);
}
