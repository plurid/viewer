import { pairCommands } from './window-commands/pair';
import { comparisonCommands } from './window-commands/comparison';
import { gitCommands } from '../git/commands';
import { journalCommands } from '../journal/commands';
import { actionCommands } from '../actions/commands';
import type { CommandDefinition } from './registry';
import { toolsCommands } from './window-commands/tools';
import { navigationCommands } from './window-commands/navigation';
import { workspacesCommands } from './window-commands/workspaces';
import { historyCommands } from './window-commands/history';
import { arrangementCommands } from './window-commands/arrangement';
import { planeLayoutCommands } from './window-commands/plane-layout';
import { previewsCommands } from './window-commands/previews';
import { textCommands } from './window-commands/text';
import { sidebarCommands } from './window-commands/sidebar';
import { catalogCommands } from './window-commands/catalog';
import { settingsCommands } from './window-commands/settings';
import { keysCommands } from './window-commands/keys';
import { viewsCommands } from './window-commands/views';
import { tilingCommands } from './window-commands/tiling';
import { templateCommands } from './window-commands/templates';
import { explodeCommands } from './window-commands/explode';
import { profileCommands } from './window-commands/profiles';
import { windowScopes, type WindowActions } from './window-commands/scope';

export type { WindowActions };
/** Window commands in a stable order: menus list each group's commands in this order and
 * the palette breaks ranking ties by it. */
export function windowCommands(actions: WindowActions): CommandDefinition[] {
  const scopes = windowScopes(actions);
  return [
    ...journalCommands(scopes),
    ...toolsCommands(scopes),
    ...navigationCommands(scopes),
    ...workspacesCommands(scopes),
    ...historyCommands(scopes),
    ...arrangementCommands(scopes),
    ...planeLayoutCommands(scopes),
    ...previewsCommands(scopes),
    ...textCommands(scopes),
    ...sidebarCommands(scopes),
    ...catalogCommands(scopes),
    ...keysCommands(scopes),
    ...viewsCommands(scopes),
    ...tilingCommands(scopes),
    ...pairCommands(scopes),
    ...comparisonCommands(scopes),
    ...gitCommands(scopes, {
      start: (kind, target) => actions.workspace.newGitAction(target, { kind }),
      commit: (target) => actions.gitCommit(target),
    }),
    ...templateCommands(scopes),
    ...explodeCommands(scopes),
    ...profileCommands(scopes),
    ...settingsCommands(scopes),
    ...actionCommands(),
  ];
}
