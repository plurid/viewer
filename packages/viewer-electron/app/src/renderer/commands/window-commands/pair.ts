import { baseName } from '../../../domain/planes';
import { startPlaneHints } from '../../keys/PlaneHints';
import {
  activeWorkspace,
  announce,
  navigate,
  pairOf,
  pairPanes,
  setPairSync,
  unpairPane,
} from '../../state/store';
import type { CommandContext, CommandDefinition } from '../registry';
import type { WindowScopes } from './scope';

/**
 * A COMMANDER'S PAIR (2026-10-24): two folder planes as Norton's and Midnight's two panels. View side
 * by side (or stacked) pairs the planes it shows, Pair with… any two; ⌃⌘C and ⌃⌘X copy and move
 * the selection to the other, swap trades their folders, and the two may follow each other into
 * subfolders. Not ⌘F5/F6: ⌃⌘ with the letter one already knows for copy and cut.
 */
export function pairCommands({ actions, paneScope }: WindowScopes): CommandDefinition[] {
  const partner = (context: CommandContext) =>
    context.paneID && context.folder ? pairOf(context.paneID) : undefined;
  const paired = (context: CommandContext) => paneScope(context) && !!partner(context);
  const chosen = (context: CommandContext) => paired(context) && context.selection.length > 0;
  const transfer = (kind: 'copy' | 'move') => async (context: CommandContext) => {
    const other = partner(context);
    if (!other) return;
    await window.viewer.operate({
      kind,
      sources: context.selection.map((entry) => entry.path),
      destination: other.path,
    });
  };
  const command = (definition: Omit<CommandDefinition, 'group'>): CommandDefinition => ({
    ...definition,
    group: 'Pair',
  });
  return [
    command({
      id: 'copy-to-pair',
      label: (context) => `Copy to ${baseName(partner(context)?.path ?? '') || 'the other folder'}`,
      icon: 'copy',
      aliases: ['copy to other', 'commander', 'f5'],
      shortcut: '⌃⌘C',
      when: chosen,
      run: transfer('copy'),
    }),
    command({
      id: 'move-to-pair',
      label: (context) => `Move to ${baseName(partner(context)?.path ?? '') || 'the other folder'}`,
      icon: 'move',
      aliases: ['move to other', 'commander', 'f6'],
      shortcut: '⌃⌘X',
      when: chosen,
      run: transfer('move'),
    }),
    command({
      id: 'swap-pair-folders',
      label: 'Swap the pair’s folders',
      icon: 'side-by-side',
      aliases: ['swap panels', 'exchange', 'commander'],
      when: paired,
      run: (context) => {
        const other = partner(context);
        const here = context.folder;
        if (!other || !here) return;
        navigate(here.id, other.path, true);
        navigate(other.id, here.path, true);
      },
    }),
    command({
      id: 'focus-pair',
      label: 'The other folder of the pair',
      icon: 'right',
      aliases: ['other panel', 'switch panel', 'tab', 'commander'],
      when: paired,
      run: (context) => {
        const other = partner(context);
        if (other) actions.workspace.focusPane(other.id, { activate: true });
      },
    }),
    command({
      id: 'pair-sync',
      label: (context) =>
        context.folder?.pairSync ? 'Stop following each other' : 'Follow each other into folders',
      icon: 'link',
      aliases: ['sync navigation', 'synchronise', 'commander'],
      when: paired,
      run: (context) => {
        if (context.paneID) setPairSync(context.paneID, !context.folder?.pairSync);
      },
    }),
    command({
      id: 'pair-with',
      label: 'Pair with…',
      icon: 'side-by-side',
      aliases: ['pair', 'commander', 'dual pane'],
      when: (context) => paneScope(context) && !!context.folder,
      run: (context) => {
        const id = context.paneID;
        if (!id) return;
        // the planes in view, labelled: the one chosen pairs with this one
        startPlaneHints((chosen) => {
          const other = activeWorkspace().panes.find((pane) => pane.id === chosen);
          if (other?.type !== 'folder' || other.id === id)
            announce('Pair a folder plane with another folder plane.');
          else pairPanes(id, other.id);
        });
      },
    }),
    command({
      id: 'unpair',
      label: 'Unpair',
      icon: 'close',
      aliases: ['unpair', 'commander'],
      when: paired,
      run: (context) => {
        if (context.paneID) unpairPane(context.paneID);
      },
    }),
    command({
      id: 'select-by-pattern',
      label: 'Select by pattern…',
      icon: 'check',
      aliases: ['select group', 'glob', 'wildcard', 'commander'],
      shortcut: '⌃⌘=',
      when: (context) => paneScope(context) && !!context.folder,
      run: () => actions.palette('line', 'select '),
    }),
    command({
      id: 'deselect-by-pattern',
      label: 'Deselect by pattern…',
      icon: 'close',
      aliases: ['unselect group', 'glob', 'wildcard', 'commander'],
      shortcut: '⌃⌘-',
      when: (context) => paneScope(context) && !!context.folder,
      run: () => actions.palette('line', 'deselect '),
    }),
  ];
}
