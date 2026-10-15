import { actionCommands } from '../actions/commands';
import type { CommandDefinition } from './registry';
import { toolsCommands } from './window-commands/tools';
import { navigationCommands } from './window-commands/navigation';
import { workspacesCommands } from './window-commands/workspaces';
import { historyCommands } from './window-commands/history';
import { arrangementCommands } from './window-commands/arrangement';
import { previewsCommands } from './window-commands/previews';
import { sidebarCommands } from './window-commands/sidebar';
import { catalogCommands } from './window-commands/catalog';
import { windowScopes, type WindowActions } from './window-commands/scope';

export type { WindowActions };
/** Window commands in a stable order: menus list each group's commands in this order and
 * the palette breaks ranking ties by it. */
export function windowCommands(actions: WindowActions): CommandDefinition[] {
  const scopes = windowScopes(actions);
  return [
    ...toolsCommands(scopes),
    ...navigationCommands(scopes),
    ...workspacesCommands(scopes),
    ...historyCommands(scopes),
    ...arrangementCommands(scopes),
    ...previewsCommands(scopes),
    ...sidebarCommands(scopes),
    ...catalogCommands(scopes),
    ...actionCommands(),
  ];
}
