import type { CommandContext, CommandDefinition } from '../registry';
import { editingPlane } from '../../editing/planes';
import type { WindowScopes } from './scope';
import { saveAll } from '../../editing/unsaved';
import { announce } from '../../state/store';

/** What Save all did, said briefly. */
export function savedText(result: { saved: number; failed: number; unnamed: number }): string {
  const parts = [
    result.saved
      ? `Saved ${result.saved} ${result.saved === 1 ? 'file' : 'files'}`
      : 'Nothing to save',
    result.failed ? `${result.failed} not saved` : '',
    result.unnamed
      ? `${result.unnamed} scratch ${result.unnamed === 1 ? 'plane has' : 'planes have'} no file yet`
      : '',
  ].filter(Boolean);
  return parts.join(' · ') + '.';
}

/**
 * TEXT (2026-10-23): editing a previewed file where it is, and scratch planes of unsaved text. Each
 * acts on the plane's own editing, so a command a plane does not offer is not shown. None is an
 * agent command (`agent-safety.ts`): agents neither write text nor save it.
 */
export function textCommands({
  actions,
  space,
  windowScope,
  paneScope,
}: WindowScopes): CommandDefinition[] {
  const plane = (context: CommandContext) => editingPlane(context.paneID);
  return [
    {
      id: 'new-scratch-plane',
      label: 'New scratch plane',
      group: 'Text',
      icon: 'file',
      aliases: ['scratch', 'untitled', 'new text', 'note', 'buffer'],
      shortcut: '⌘T',
      when: (context) =>
        ['window', 'workspace', 'folder', 'files', 'preview'].includes(context.scope) &&
        actions.ready &&
        space.panes.length < 200,
      run: () => actions.workspace.newScratch(),
    },
    {
      id: 'edit-file',
      label: 'Edit text',
      group: 'Text',
      icon: 'rename',
      aliases: ['edit', 'modify'],
      shortcut: '⌘E',
      when: (context) => paneScope(context) && !!plane(context)?.edit,
      run: (context) => plane(context)?.edit?.(),
    },
    {
      id: 'save-file',
      label: 'Save',
      group: 'Text',
      icon: 'check',
      shortcut: '⌘S',
      when: (context) => paneScope(context) && !!plane(context)?.save,
      run: async (context) => {
        await plane(context)?.save?.();
      },
    },
    {
      id: 'save-file-as',
      label: 'Save as…',
      group: 'Text',
      icon: 'copy',
      shortcut: '⇧⌘S',
      when: (context) => paneScope(context) && !!plane(context)?.saveAs,
      run: async (context) => {
        await plane(context)?.saveAs?.();
      },
    },
    {
      id: 'save-all',
      label: 'Save all',
      group: 'Text',
      icon: 'check',
      aliases: ['wa', 'save everything'],
      when: (context) => windowScope(context) && actions.ready,
      run: async () => {
        announce(savedText(await saveAll()));
      },
    },
    {
      id: 'revert-file',
      label: 'Revert to saved…',
      group: 'Text',
      icon: 'restore',
      aliases: ['discard changes', 'undo all'],
      when: (context) => paneScope(context) && !!plane(context)?.revert,
      run: (context) => plane(context)?.revert?.(),
    },
    {
      id: 'done-editing',
      label: 'Done editing',
      group: 'Text',
      icon: 'eye',
      aliases: ['stop editing', 'read'],
      when: (context) => windowScope(context) && !!plane(context)?.done,
      run: (context) => plane(context)?.done?.(),
    },
  ];
}
