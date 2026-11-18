import { titleCase } from '../../../domain/title-case';
import { getState, setOperationsOpen } from '../../state/store';
import { redoableTime, undoableTime } from '../../state/jobs';
import { lastLensRedo, lastLensUndo, redoLens, undoLens } from '../../state/lenses';
import type { CommandDefinition } from '../registry';
import type { WindowScopes } from './scope';
import { forgetSuggestions, showHiddenInsights } from '../history';
import { hasHiddenOffers } from '../../workspace/workspace-offer';

/** Undo and Redo pick the most recent action, whether a file operation or a lens edit. */
function latest(direction: 'undo' | 'redo') {
  const job = getState().jobs.find((item) =>
    direction === 'undo' ? item.undoable : item.redoable,
  );
  const lens = direction === 'undo' ? lastLensUndo() : lastLensRedo();
  const jobTime = job ? (direction === 'undo' ? undoableTime(job.id) : redoableTime(job.id)) : 0;
  if (lens && (!job || lens.time >= jobTime)) return { lens };
  return job ? { job } : undefined;
}

/** File operation history: recent jobs, Undo and Redo. */
export function historyCommands({ windowScope }: WindowScopes): CommandDefinition[] {
  const commands: CommandDefinition[] = [
    {
      id: 'forget-suggestions',
      label: 'Forget Learned Suggestions',
      group: 'Window',
      icon: 'close',
      aliases: ['clear suggestions', 'reset suggestions', 'suggested'],
      when: (context) =>
        windowScope(context) && Object.keys(getState().saved.ui.suggestionHistory ?? {}).length > 0,
      run: () => forgetSuggestions(),
    },
    {
      id: 'show-hidden-insights',
      label: 'Show Hidden Insights',
      group: 'Window',
      icon: 'eye',
      aliases: ['insights', 'dismissed insights', 'restore insights'],
      // it shows dismissed workspace offers again: the person's choice alone
      humanOnly: true,
      when: (context) =>
        windowScope(context) &&
        (Object.keys(getState().saved.ui.insightsDismissed ?? {}).length > 0 || hasHiddenOffers()),
      run: () => showHiddenInsights(),
    },
    {
      id: 'recent-operations',
      label: 'File Operations',
      group: 'Files',
      icon: 'copy',
      aliases: ['jobs', 'operations', 'progress', 'recent file operations', 'operation history'],
      when: windowScope,
      run: () => setOperationsOpen(!getState().operationsOpen, true),
    },
    {
      id: 'undo-file',
      label: () => {
        const action = latest('undo');
        return action?.lens ? titleCase(`Undo ${action.lens.label}`) : 'Undo File Operation';
      },
      group: 'Files',
      icon: 'left',
      shortcut: '⌘Z',
      when: (context) => windowScope(context) && !!latest('undo'),
      run: async () => {
        const action = latest('undo');
        if (action?.lens) await undoLens();
        else if (action?.job) await window.viewer.undo(action.job.id);
      },
    },
    {
      id: 'redo-file',
      label: () => {
        const action = latest('redo');
        return action?.lens ? titleCase(`Redo ${action.lens.label}`) : 'Redo File Operation';
      },
      group: 'Files',
      icon: 'right',
      shortcut: '⇧⌘Z',
      when: (context) => windowScope(context) && !!latest('redo'),
      run: async () => {
        const action = latest('redo');
        if (action?.lens) await redoLens();
        else if (action?.job) await window.viewer.redo(action.job.id);
      },
    },
  ];
  return commands;
}
