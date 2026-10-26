import type {
  CapturedTarget,
  CustomAction,
  ActionValues,
  ExecutionTask,
} from '../../domain/automation/actions';

/** Subscribe before admission: a short process may finish before its ID reply arrives. */
export async function executeAction(
  action: CustomAction,
  target: CapturedTarget,
  values: ActionValues,
): Promise<void> {
  const received = new Map<string, ExecutionTask>();
  let finish: ((task: ExecutionTask) => void) | undefined;
  let id: string | undefined;
  const unsubscribe = window.viewer.onEvent((event) => {
    if (event.type !== 'execution') return;
    received.set(event.task.id, event.task);
    if (event.task.id === id && event.task.status !== 'running') finish?.(event.task);
  });
  try {
    const supplied = Object.fromEntries(
      (action.inputs ?? []).map((input) => [input.name, values[input.name] ?? input.initial ?? '']),
    );
    id = await window.viewer.customExecute(action.id, target, supplied);
    const listed = (await window.viewer.executionList()).find((task) => task.id === id);
    const known = received.get(id) ?? listed;
    const task =
      known && known.status !== 'running'
        ? known
        : await new Promise<ExecutionTask>((resolve) => {
            finish = resolve;
          });
    if (task.status !== 'completed')
      throw new Error(task.error || `Command ${task.status}: ${action.name}`);
  } finally {
    unsubscribe();
  }
}
