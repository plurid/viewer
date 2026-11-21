import { dialog, type BrowserWindow, type MessageBoxOptions } from 'electron';
import type { AgentProposal } from '../../domain/agents/requests';
import { proposalRequester } from '../../domain/agents/review';
import { sharedClientID } from '../../domain/agents/clients';
import { windowDialogs } from './window-dialogs';

const maxConfirmationDetail = 6000;

function requesterInPrompt(proposal: AgentProposal): string {
  if (proposal.clientID?.startsWith('chat:')) return 'Chat';
  const requester = proposalRequester(proposal);
  if (proposal.clientName?.trim()) return `“${requester}”`;
  if (proposal.clientID === sharedClientID) return 'the shared agent connection';
  return 'the agent';
}

/** Keeps Trash confirmation details within the dialog bound on whole lines with a stated remainder and closing note. */
function boundedRemovalDetail(detail: string): string {
  if (detail.length <= maxConfirmationDetail) return detail;
  const sections = detail.split('\n\n');
  if (sections.length >= 3) {
    const header = sections[0]!;
    const closing = sections.at(-1)!;
    const lines = sections.slice(1, -1).join('\n\n').split('\n').filter(Boolean);
    const kept: string[] = [];
    for (let index = 0; index < lines.length; index++) {
      const remaining = lines.length - index - 1;
      const suffix = remaining > 0 ? `\n…and ${remaining} more, listed in the review.` : '';
      const candidate = `${header}\n\n${[...kept, lines[index]!].join('\n')}${suffix}\n\n${closing}`;
      if (candidate.length > maxConfirmationDetail) break;
      kept.push(lines[index]!);
    }
    const remaining = lines.length - kept.length;
    const middle = kept.length
      ? `${kept.join('\n')}${remaining > 0 ? `\n…and ${remaining} more, listed in the review.` : ''}`
      : `…${lines.length} items, listed in the review.`;
    const composed = `${header}\n\n${middle}\n\n${closing}`;
    if (composed.length <= maxConfirmationDetail) return composed;
  }
  const lines = detail.split('\n');
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const remaining = lines.length - index - 1;
    const suffix = remaining > 0 ? `\n…and ${remaining} more, listed in the review.` : '';
    const candidate = `${[...kept, lines[index]!].join('\n')}${suffix}`;
    if (candidate.length > maxConfirmationDetail) break;
    kept.push(lines[index]!);
  }
  const remaining = lines.length - kept.length;
  return `${kept.join('\n')}${remaining > 0 ? `\n…and ${remaining} more, listed in the review.` : ''}`.slice(
    0,
    maxConfirmationDetail,
  );
}

/** Ordinary notices use the owning window. Security approvals and failed renderers stay native. */
export async function showViewerMessage(
  window: BrowserWindow | undefined,
  options: MessageBoxOptions,
  destructiveId?: number,
) {
  const owner = windowDialogs(window);
  if (owner && !options.checkboxLabel) return owner.message(options, destructiveId);
  return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
}

/** The desktop process asks the person itself; the renderer cannot answer this dialog. */
export async function confirmAgentProposal(
  window: BrowserWindow | undefined,
  proposal: AgentProposal,
): Promise<boolean> {
  const files = proposal.target?.selection.map((file) => file.path) ?? [];
  const listed = files.slice(0, 30).join('\n');
  const more = files.length > 30 ? `\n…and ${files.length - 30} more, listed in the review.` : '';
  const removal = proposal.removal === 'trash';
  const actor = requesterInPrompt(proposal);
  const options: MessageBoxOptions = {
    type: 'warning',
    title: 'Agent request',
    message: removal
      ? `Allow ${actor} to move ${files.length === 1 ? 'this item' : `these ${files.length} items`} to the Trash?`
      : proposal.kind === 'configuration'
        ? `Allow ${actor} to change your configuration?`
        : `Allow ${actor} to run “${proposal.title}”?`,
    // a removal shows what was reviewed: each folder with the contents counted in it
    detail: removal
      ? boundedRemovalDetail(proposal.detail)
      : (proposal.detail + (files.length ? '\n\nItems:\n' + listed + more : '')).slice(
          0,
          maxConfirmationDetail,
        ),
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
