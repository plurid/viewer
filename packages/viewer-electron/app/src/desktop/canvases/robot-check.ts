import { createHash } from 'node:crypto';
import type { CanvasDocument } from '../../domain/canvases/document';
import { robotTaskSchema } from '../../domain/robotics/task';
import type {
  RobotTask,
  RobotCheckReport,
  RobotComparisonReport,
} from '../../domain/robotics/task';
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

export function compareCanvasRobots(
  original: CanvasDocument,
  alternative: CanvasDocument,
): RobotComparisonReport {
  const unavailable = (reason: string): RobotComparisonReport => ({
    status: 'unavailable',
    reason,
  });
  if (alternative.fork?.id !== original.id)
    return unavailable('Compare a quoted alternative with its original canvas.');
  const first = canvasRobotReport(original);
  const second = canvasRobotReport(alternative);
  if (first?.status !== 'checked' || second?.status !== 'checked')
    return unavailable(
      'Check the current poses in both canvases before comparing base placements.',
    );
  const source = (doc: CanvasDocument) =>
    doc.sources.find((s) => s.id === doc.robotCheck!.sourceID)!;
  if (
    source(original).hash !== source(alternative).hash ||
    JSON.stringify(source(original).data.robot) !== JSON.stringify(source(alternative).data.robot)
  )
    return unavailable('The model sources differ. Use the same robot model in both canvases.');
  const fixed = (task: RobotTask) =>
    JSON.stringify({
      units: task.units,
      tool: task.tool,
      tolerance: task.tolerance,
      targets: task.targets,
      order: task.poses.map((pose) => pose.targetID),
    });
  if (fixed(first.input) !== fixed(second.input))
    return unavailable(
      'Targets, their order, tool point and tolerance must stay fixed to compare base placements.',
    );
  const side = (doc: CanvasDocument, report: typeof first) => ({
    id: doc.id,
    title: doc.title,
    revision: doc.revision,
    stateRevision: doc.stateRevision,
    inputHash: doc.robotCheck!.inputHash,
    report,
  });
  return {
    status: 'compared',
    sourceHash: source(original).hash,
    original: side(original, first),
    alternative: side(alternative, second),
  };
}
