import { getState, setOperationsOpen } from '../../state/store';
import { redoableTime, undoableTime } from '../../state/jobs';
import { lastLensRedo, lastLensUndo, redoLens, undoLens } from '../../state/lenses';
import type { CommandDefinition } from '../registry';
import type { WindowScopes } from './scope';

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
      id: 'recent-operations',
      label: 'Recent file operations',
      group: 'Files',
      icon: 'copy',
      aliases: ['jobs', 'operations', 'progress'],
      when: (context) => windowScope(context) && !!context.jobs?.length,
      run: () => setOperationsOpen(true, true),
    },
    {
      id: 'undo-file',
      label: () => {
        const action = latest('undo');
        return action?.lens ? `Undo ${action.lens.label}` : 'Undo file operation';
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
        return action?.lens ? `Redo ${action.lens.label}` : 'Redo file operation';
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
