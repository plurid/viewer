import { dialog, type BrowserWindow, type MessageBoxOptions } from 'electron';
import type { AgentProposal } from '../../domain/agents/requests';

/** The desktop process asks the person itself; the renderer cannot answer this dialog. */
export async function confirmAgentProposal(
  window: BrowserWindow | undefined,
  proposal: AgentProposal,
): Promise<boolean> {
  const files = proposal.target?.selection.map((file) => file.path) ?? [];
  const listed = files.slice(0, 30).join('\n');
  const more = files.length > 30 ? `\n…and ${files.length - 30} more, listed in the review.` : '';
  const removal = proposal.removal === 'trash';
  const options: MessageBoxOptions = {
    type: 'warning',
    title: 'Agent request',
    message: removal
      ? `Allow the agent to move ${files.length === 1 ? 'this item' : `these ${files.length} items`} to the Trash?`
      : proposal.kind === 'configuration'
        ? 'Allow the agent to change your configuration?'
        : `Allow the agent to run “${proposal.title}”?`,
    // a removal shows what was reviewed: each folder with the contents counted in it
    detail: (removal
      ? proposal.detail
      : proposal.detail + (files.length ? '\n\nItems:\n' + listed + more : '')
    ).slice(0, 6000),
    buttons: [
      'Cancel',
      removal
        ? 'Move to Trash'
        : proposal.kind === 'task-workflow'
          ? 'Create task'
          : proposal.kind === 'configuration'
            ? 'Change'
            : proposal.kind === 'speech'
              ? proposal.speech?.kind === 'use'
                ? 'Choose model'
                : proposal.speech?.kind === 'import'
                  ? 'Import model'
                  : 'Download model'
              : 'Run',
    ],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  return showConfirmation(window, options);
}
export function confirmNatively(
  window: BrowserWindow | undefined,
  message: string,
  detail: string,
  action: string,
): Promise<boolean> {
  return showConfirmation(window, {
    type: 'warning',
    message,
    detail,
    buttons: ['Cancel', action],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
}
/** A native question with buttons of its own: the index of the one chosen, `cancelId` when the
 * dialog is dismissed. */
export async function askNatively(
  window: BrowserWindow | undefined,
  options: {
    message: string;
    detail: string;
    buttons: string[];
    defaultId: number;
    cancelId: number;
    /** Withdraws the question: it resolves with `cancelId`. */
    signal?: AbortSignal;
  },
): Promise<number> {
  const parent = window && !window.isDestroyed() ? window : undefined;
  const box: MessageBoxOptions = { type: 'warning', noLink: true, ...options };
  const { response } = parent
    ? await dialog.showMessageBox(parent, box)
    : await dialog.showMessageBox(box);
  return response;
}
/** Button 1 is the only affirmative answer; closing or cancelling refuses. */
async function showConfirmation(
  window: BrowserWindow | undefined,
  options: MessageBoxOptions,
): Promise<boolean> {
  const parent = window && !window.isDestroyed() ? window : undefined;
  const { response } = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  return response === 1;
}
