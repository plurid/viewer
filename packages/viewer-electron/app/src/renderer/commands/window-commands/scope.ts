import { activeWorkspace, getState } from '../../state/store';
import type { WorkspaceController } from '../../workspace/context';
import type { CommandContext } from '../registry';

export interface WindowActions {
  workspace: WorkspaceController;
  ready: boolean;
  palette(mode: 'commands' | 'files' | 'workspaces' | 'settings'): void;
  settings(): void;
  workspaceDialog(kind: 'new' | 'rename' | 'delete' | 'background'): void;
  renameShortcut(path: string, name: string): void;
  switchWorkspace(id: string): Promise<void>;
  restoreWorkspace(): Promise<void>;
  spatialTool(tool: 'rotate' | 'scale' | 'translate' | null): void;
  tool: 'rotate' | 'scale' | 'translate' | null;
  goTo(): void;
  connectServer(): void;
  findTagged(): void;
  openWith(paths: string[]): void;
  /** Names a recorded macro and saves it as a command sequence. */
  saveMacro(commands: string[]): void;
  /** Save view… (a name) and Views… (go, rename, remove). */
  viewDialog(kind: 'save' | 'manage'): void;
  /** Names the planes in view as a layout template. */
  templateDialog(): void;
  /** Names the current chrome and look as a setting profile. */
  profileDialog(): void;
}
/** The state snapshot and scope predicates shared by every window command group. */
export function windowScopes(actions: WindowActions) {
  const state = getState();
  const space = activeWorkspace();
  const windowScope = (context: CommandContext) => context.scope === 'window';
  const workspaceScope = (context: CommandContext) =>
    ['window', 'workspace'].includes(context.scope);
  const paneScope = (context: CommandContext) =>
    ['window', 'folder', 'files', 'preview'].includes(context.scope) &&
    !!context.paneID &&
    space.panes.some((pane) => pane.id === context.paneID) &&
    actions.ready;
  const sidebar = (context: CommandContext) => context.scope === 'sidebar' && !!context.sidebar;
  const shortcut = (context: CommandContext) => sidebar(context) && !!context.sidebar?.path;
  return { actions, state, space, windowScope, workspaceScope, paneScope, sidebar, shortcut };
}
export type WindowScopes = ReturnType<typeof windowScopes>;
