import type { AgentProposal } from './requests';
import { needsNativeConfirmation } from './requests';

const count = (value: number) => value.toLocaleString();

/** The button that approves a proposal in Viewer's review. */
export function reviewButton(proposal: AgentProposal): string {
  switch (proposal.kind) {
    case 'command':
      return proposal.removal === 'trash' ? 'Move to Trash' : 'Run action';
    case 'configuration':
      return 'Apply changes';
    case 'speech':
      return proposal.speech?.kind === 'use'
        ? 'Choose model'
        : proposal.speech?.kind === 'import'
          ? 'Import model'
          : 'Download model';
    case 'task-workflow':
      return 'Create task';
    case 'transform':
      return 'Export';
    case 'navigation':
      return proposal.title;
    case 'terminal-write':
      return 'Run action';
  }
}

/** What approving this proposal does, for its kind and target. */
function effect(proposal: AgentProposal): string {
  const selected = proposal.target?.selection.length ?? 0;
  switch (proposal.kind) {
    case 'command': {
      if (proposal.removal === 'trash')
        return selected === 1
          ? 'Then this item goes to the system Trash, where you can restore it.'
          : `Then these ${count(selected)} items go to the system Trash, where you can restore them.`;
      const where = !proposal.target
        ? ''
        : !selected
          ? ' in this folder'
          : selected === 1
            ? ' on the selected item'
            : ` on the ${count(selected)} selected items`;
      return `Then “${proposal.title}” runs${where}.`;
    }
    case 'configuration': {
      const changes = proposal.patches?.length ?? 0;
      return changes === 1
        ? 'Then this change is saved to your configuration.'
        : `Then these ${count(changes)} changes are saved to your configuration.`;
    }
    case 'speech':
      return proposal.speech?.kind === 'use'
        ? 'Then Viewer uses this model for speech input.'
        : proposal.speech?.kind === 'import'
          ? 'Then Viewer imports the model file.'
          : 'Then the download starts.';
    case 'task-workflow':
      return proposal.taskSetup
        ? `Then Viewer creates the worktree at ${proposal.taskSetup.destination} and its task area.`
        : 'Then Viewer creates the worktree and its task area.';
    case 'transform': {
      const output = proposal.transform
        ? `${proposal.transform.name} as a new file in ${proposal.transform.destination}`
        : 'a new file';
      return `Export saves ${output}. The sources and existing files are kept.`;
    }
    case 'navigation':
      return `${proposal.title} changes only what Viewer shows. No files change.`;
    case 'terminal-write':
      return 'Agents cannot type into terminals, so this request cannot run.';
  }
}

/** The review's closing note. It names the system dialog only for a proposal that gets one. */
export function reviewNote(proposal: AgentProposal): string {
  if (needsNativeConfirmation(proposal))
    return `After ${reviewButton(proposal)}, a system dialog asks once more. ${effect(proposal)}`;
  if (proposal.kind === 'terminal-write') return effect(proposal);
  return proposal.kind === 'transform'
    ? `${effect(proposal)} No system dialog follows: this review is the approval.`
    : `${effect(proposal)} No system dialog follows.`;
}
