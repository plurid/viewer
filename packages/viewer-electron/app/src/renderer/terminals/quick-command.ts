import type { CapturedTarget, ExecutionTask } from '../../domain/automation/actions';
import type { CommandContext } from '../commands/registry';
import type { WorkspaceController } from '../workspace/context';
import { parentPath } from '../commands/folder';
import { activeWorkspace, getState } from '../state/store';
import { errorMessage } from '../../domain/errors';
import { attachCommandReceipt } from '../tasks/state';

interface QuickCommandState {
  draft: string;
  target?: CapturedTarget;
  task?: ExecutionTask;
  pending: boolean;
  visible: boolean;
  error: string;
}

// Per-window memory survives the panel closing; command text is never a UI preference.
let state: QuickCommandState = { draft: '', pending: false, visible: false, error: '' };
let tasks: readonly ExecutionTask[] = [];
const listeners = new Set<() => void>();
export const quickCommandSnapshot = () => state;
export const subscribeQuickCommand = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function change(patch: Partial<QuickCommandState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
export function captureCommandTarget(
  context: CommandContext,
  workspace: Pick<WorkspaceController, 'rootID'>,
): CapturedTarget {
  const current = getState();
  const space = activeWorkspace(current);
  const pane = space.panes.find((pane) => pane.id === context.paneID);
  const fileContext = pane && ['folder', 'preview', 'terminal'].includes(pane.type);
  const directory =
    pane?.type === 'folder'
      ? context.directory || pane.path
      : pane?.type === 'terminal'
        ? pane.path
        : pane?.type === 'preview'
          ? parentPath(pane.path)
          : current.bootstrap.home;
  return structuredClone({
    workspaceID: context.workspaceID,
    rootID: pane ? context.rootID || workspace.rootID(pane.id) || pane.id : '',
    paneID: pane?.id || '',
    panePath: fileContext ? pane.path : undefined,
    directory,
    selection: [],
  });
}
export function showQuickCommand(target: CapturedTarget, initial = '') {
  change(
    state.pending || state.task?.status === 'running'
      ? { visible: true }
      : { visible: true, target, draft: initial || state.draft, error: '' },
  );
}
export function hideQuickCommand() {
  change({ visible: false });
}
export function editQuickCommand(draft: string) {
  change({ draft, error: '' });
}

/** The existing execution subscription also follows a quick command while its panel is closed. */
export function observeQuickCommands(current: readonly ExecutionTask[]) {
  tasks = current;
  const task = state.task && current.find((item) => item.id === state.task!.id);
  if (task && task !== state.task) change({ task });
}
export async function runQuickCommand(): Promise<void> {
  const { draft, target } = state;
  if (!target || !draft.trim() || state.pending || state.task?.status === 'running') return;
  change({ pending: true, task: undefined, error: '' });
  try {
    const id = await window.viewer.runCommand(draft, target);
    const task = tasks.find((task) => task.id === id) ?? {
      id,
      title: draft.trim().split('\n')[0]!.slice(0, 100),
      status: 'running' as const,
      output: '',
      directory: target.directory,
      command: draft,
      workspaceID: target.workspaceID,
      paneID: target.paneID,
    };
    change({ task });
    attachCommandReceipt(target, task);
  } catch (error) {
    change({ error: errorMessage(error) });
  } finally {
    change({ pending: false });
  }
}
