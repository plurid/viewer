import { effectiveWindowSettings } from '../../state/effective-ui';
import { getState } from '../../state/store';
import { startTour, stopTour, tourActive } from '../../workspace/tour';
import type { CommandDefinition } from '../registry';
import type { WindowScopes } from './scope';

const slots = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
/**
 * THE SPACE'S VIEWS: camera positions saved by number (⌃⌥⌘1–9, flown back to with ⌥⌘1–9
 * or prefix 1–9) or by name, kept with the workspace, and Tour through them in turn.
 */
export function viewsCommands({ actions, windowScope }: WindowScopes): CommandDefinition[] {
  const workspace = actions.workspace;
  // none before the space is ready, nor from a controller that has none
  const views = actions.ready ? (workspace.bookmarks?.() ?? []) : [];
  const exists = (name: string) => views.some((view) => view.name === name);
  return [
    ...slots.map((slot): CommandDefinition => ({
      id: `bookmark.save.${slot}`,
      label: exists(String(slot)) ? `Replace view ${slot} with this one` : `Save view as ${slot}`,
      group: 'Space',
      icon: 'star',
      aliases: ['bookmark', 'view', 'camera', String(slot)],
      when: (context) => windowScope(context) && actions.ready,
      run: () => workspace.saveBookmark(String(slot)),
    })),
    ...slots.map((slot): CommandDefinition => ({
      id: `bookmark.${slot}`,
      label: `Go to view ${slot}`,
      group: 'Space',
      icon: 'eye',
      aliases: ['bookmark', 'view', 'camera', String(slot)],
      when: (context) => windowScope(context) && exists(String(slot)),
      run: () => {
        workspace.goBookmark(String(slot));
      },
    })),
    ...views
      .filter((view) => !/^[1-9]$/.test(view.name))
      .map((view): CommandDefinition => ({
        id: `bookmark:${view.name}`,
        label: `Go to view “${view.label}”`,
        group: 'Space',
        icon: 'eye',
        aliases: ['bookmark', 'view', 'camera', view.label],
        when: windowScope,
        run: () => {
          workspace.goBookmark(view.name);
        },
      })),
    {
      id: 'bookmark-save',
      label: 'Save view…',
      group: 'Space',
      icon: 'star',
      aliases: ['bookmark', 'name view', 'camera'],
      when: (context) => windowScope(context) && actions.ready,
      run: () => actions.viewDialog('save'),
    },
    {
      id: 'bookmark-manage',
      label: 'Views…',
      group: 'Space',
      icon: 'list',
      aliases: ['bookmarks', 'saved views', 'rename view', 'remove view'],
      when: (context) => windowScope(context) && views.length > 0,
      run: () => actions.viewDialog('manage'),
    },
    tourActive()
      ? {
          id: 'tour',
          label: 'Stop tour',
          group: 'Space',
          icon: 'pause',
          aliases: ['tour', 'present', 'stop'],
          when: windowScope,
          run: stopTour,
        }
      : {
          id: 'tour',
          label: 'Tour the views',
          group: 'Space',
          icon: 'play',
          aliases: ['tour', 'present', 'presentation', 'slideshow'],
          when: (context) => windowScope(context) && views.length > 0,
          run: () => startTour(workspace, effectiveWindowSettings(getState()).tour),
        },
  ];
}
