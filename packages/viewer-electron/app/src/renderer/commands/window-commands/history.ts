import { getState, setOperationsOpen } from '../../state/store';
import type { CommandDefinition } from '../registry';
import type { WindowScopes } from './scope';

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
      label: 'Undo file operation',
      group: 'Files',
      icon: 'left',
      shortcut: '⌘Z',
      when: (context) => windowScope(context) && !!context.jobs?.some((job) => job.undoable),
      run: async () => {
        const job = getState().jobs.find((job) => job.undoable);
        if (job) await window.viewer.undo(job.id);
      },
    },
    {
      id: 'redo-file',
      label: 'Redo file operation',
      group: 'Files',
      icon: 'right',
      shortcut: '⇧⌘Z',
      when: (context) => windowScope(context) && !!context.jobs?.some((job) => job.redoable),
      run: async () => {
        const job = getState().jobs.find((job) => job.redoable);
        if (job) await window.viewer.redo(job.id);
      },
    },
  ];
  return commands;
}
