import type { ApiHandlers } from './schemas';
import type { ActionPlanner } from '../actions/planner';

type ActionHandlers = Pick<
  ApiHandlers,
  | 'actionStart'
  | 'actionGet'
  | 'actionList'
  | 'actionApply'
  | 'actionCancel'
  | 'actionUndo'
  | 'actionRecover'
  | 'actionExportSummary'
>;
interface ActionPorts {
  actions: Pick<
    ActionPlanner,
    'start' | 'get' | 'all' | 'apply' | 'cancel' | 'undo' | 'recovery' | 'exportSummary'
  >;
}

/** A plan started from a window is the person's, whatever actor its request names. */
export function createActionHandlers(ports: ActionPorts): ActionHandlers {
  return {
    actionStart: ([request]) =>
      ports.actions.start({ ...request, context: { ...request.context, actor: 'user' } }),
    actionGet: ([id]) => ports.actions.get(id),
    actionList: () => ports.actions.all(),
    actionApply: ([approval]) => ports.actions.apply(approval),
    actionCancel: ([id]) => {
      ports.actions.cancel(id);
    },
    actionUndo: ([id]) => ports.actions.undo(id),
    actionRecover: ([id]) => ports.actions.recovery(id),
    actionExportSummary: ([id, destination]) => ports.actions.exportSummary(id, destination),
  };
}
