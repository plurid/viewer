import { useEffect } from 'react';
import type { CapturedTarget } from '../../domain/automation/actions';
import type { AgentWorkspaceSnapshot, CommandDescriptor } from '../../domain/agents/requests';
import { parentPath } from '../../domain/workspaces/planes';
import { agentCatalog } from '../commands/agent-catalog';
import { captureTarget } from '../commands/programs';
import type { CommandContext, CommandRegistry } from '../commands/registry';
import { activeWorkspace, getState, report } from '../state/core';
import type { WorkspaceController } from '../workspace/context';

const publicationDelay = 80;
const selectionLimit = 2000;

interface AgentCatalogOptions {
  registry: CommandRegistry;
  controller: Pick<WorkspaceController, 'rootID'>;
  activePane: string;
  context(): CommandContext;
}

/** Publish the same registry used by people, with window actions available in every context. */
export function useAgentCatalog({
  registry,
  controller,
  activePane,
  context: windowContext,
}: AgentCatalogOptions): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const publish = () => {
      timer = undefined;
      const state = getState();
      const workspace = activeWorkspace(state);
      const workspaces: AgentWorkspaceSnapshot = {
        activeWorkspace: state.saved.activeWorkspace,
        workspaces: state.saved.workspaces.map((space) => ({
          id: space.id,
          name: space.name,
          roots: space.roots,
          tasks: space.taskAreas?.map((area) => ({
            id: area.id,
            name: area.name,
            path: area.checkout.path,
            branch: area.checkout.branch,
            commit: area.checkout.commit,
          })),
          panes: space.panes.map((pane) => ({
            id: pane.id,
            type: pane.type,
            path: pane.path,
            ...(pane.type === 'folder' ? { mode: pane.mode } : {}),
            ...(pane.type === 'search' ? { allLocations: pane.allLocations } : {}),
          })),
        })),
      };
      const context = registry.context(state.activePane) ?? windowContext();
      const pane = workspace.panes.find((pane) => pane.id === state.activePane);
      const hasDirectory = !!context.directory || !!context.folder;
      const target: CapturedTarget = hasDirectory
        ? captureTarget(context, controller)
        : {
            workspaceID: workspace.id,
            rootID: (pane && controller.rootID(pane.id)) || 'none',
            paneID: pane?.id || 'none',
            panePath: pane?.path,
            directory: pane
              ? pane.type === 'preview'
                ? parentPath(pane.path)
                : pane.path
              : state.bootstrap.home,
            selection: [],
          };
      const catalogContext = hasDirectory
        ? context
        : { ...context, directory: undefined, folder: undefined, selection: [] };
      const commands: CommandDescriptor[] =
        target.selection.length > selectionLimit
          ? []
          : agentCatalog(registry, catalogContext).map(
              ({ id, label, group, aliases, shortcut }) => ({
                id,
                label,
                group,
                aliases: [...aliases],
                shortcut,
              }),
            );
      if (target.selection.length > selectionLimit) target.selection = [];
      const owners: [string, string][] = [];
      for (const pane of workspace.panes) {
        const root = workspace.roots.includes(pane.id) ? pane.id : controller.rootID(pane.id);
        if (root) owners.push([pane.id, root]);
      }
      void window.viewer
        .commandsPublish(target, commands, workspaces, Object.fromEntries(owners))
        .catch(report);
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(publish, publicationDelay);
    };
    const unsubscribe = registry.subscribe(schedule);
    // Human commands can run as soon as the registry is ready. Their desktop
    // ownership and Chat context must exist before the first debounced update.
    publish();
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [registry, controller, activePane, windowContext]);
}
