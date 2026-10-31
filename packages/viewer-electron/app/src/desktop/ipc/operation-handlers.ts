import type { ApiHandlers } from './schemas';
import type { Operations } from '../operations/operations';
import type { OperationPlans } from '../operations/operation-plans';
import type { Checkpoints } from '../operations/checkpoints';

type OperationHandlers = Pick<
  ApiHandlers,
  | 'operate'
  | 'jobs'
  | 'dismissJobs'
  | 'cancelJob'
  | 'resolveCollision'
  | 'undo'
  | 'redo'
  | 'operationPlan'
  | 'checkpoints'
>;
interface OperationPorts {
  operations: Pick<
    Operations,
    'start' | 'load' | 'all' | 'dismiss' | 'cancel' | 'resolve' | 'undo' | 'redo'
  >;
  plans: Pick<OperationPlans, 'request'>;
  checkpoints: Pick<Checkpoints, 'list' | 'estimate' | 'remove' | 'restore'>;
  /** The window is carrying out an agent's command: what it starts is the agent's. */
  isAgent(owner: number): boolean;
  /** The person's native answer: a checkpoint's private copy is erased, never moved to the Trash. */
  confirmCheckpointRemoval(owner: number): Promise<boolean>;
}

/** A checkpoint is restored through the operations queue, as an ordinary file operation. */
export function createOperationHandlers(ports: OperationPorts): OperationHandlers {
  return {
    operate: ([request], owner) =>
      ports.operations.start(request, ports.isAgent(owner) ? 'agent' : 'person'),
    jobs: async () => {
      await ports.operations.load();
      return ports.operations.all();
    },
    dismissJobs: ([ids]) => ports.operations.dismiss(ids),
    cancelJob: ([id]) => ports.operations.cancel(id),
    resolveCollision: ([id, decision, applyAll]) =>
      ports.operations.resolve(id, decision, applyAll),
    undo: ([id]) => ports.operations.undo(id),
    redo: ([id]) => ports.operations.redo(id),
    operationPlan: ([request]) => ports.plans.request(request),
    checkpoints: async ([request], owner) => {
      if (request.kind === 'list') return ports.checkpoints.list();
      if (request.kind === 'estimate') return ports.checkpoints.estimate(request.paths);
      if (request.kind === 'remove') {
        if (await ports.confirmCheckpointRemoval(owner)) await ports.checkpoints.remove(request.id);
        return null;
      }
      return ports.checkpoints.restore(request.id, request.destination, ports.operations);
    },
  };
}
