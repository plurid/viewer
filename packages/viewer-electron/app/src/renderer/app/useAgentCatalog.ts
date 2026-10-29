import { useEffect } from 'react';
import type { CapturedTarget } from '../../domain/automation/actions';
import type { AgentWorkspaceSnapshot, CommandDescriptor } from '../../domain/agents/requests';
import { parentPath } from '../../domain/workspaces/planes';
import { agentCatalog } from '../commands/agent-catalog';
import { captureTarget } from '../commands/programs';
import type { CommandContext, CommandRegistry } from '../commands/registry';
import { activeWorkspace, getState, report, subscribe, type ViewerState } from '../state/core';
import type { WorkspaceController } from '../workspace/context';

const publicationDelay = 80;
const selectionLimit = 2000;

interface AgentCatalogOptions {
  registry: CommandRegistry;
  controller: Pick<WorkspaceController, 'rootID'>;
  context(): CommandContext;
}

/**
 * The command list and the selection are for agents and Chat. Without either, publishing them
 * cost every click, key and selection change a few hundred commands and up to 2000 file entries.
 */
function commandsWanted(state: ViewerState): boolean {
  return (
    state.settings.settings.agents.enabled ||
    state.saved.workspaces.some((space) => space.panes.some((pane) => pane.type === 'chat'))
  );
}

/** The workspaces as desktop checks see them: Git and agent targets are validated against this. */
function workspaceSnapshot(state: ViewerState): AgentWorkspaceSnapshot {
  return {
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
}

/** Which planes exist, and the roots: a new plane checks its own target as soon as it mounts. */
function planeSet(snapshot: AgentWorkspaceSnapshot): string {
  return JSON.stringify(
    snapshot.workspaces.map((space) => [space.id, space.roots, space.panes.map((pane) => pane.id)]),
  );
}

/** Publish the same registry used by people, with window actions available in every context. */
export function useAgentCatalog({
  registry,
  controller,
  context: windowContext,
}: AgentCatalogOptions): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const publish = () => {
      timer = undefined;
      const state = getState();
      const workspace = activeWorkspace(state);
      const workspaces = workspaceSnapshot(state);
      shape = JSON.stringify(workspaces);
      planes = planeSet(workspaces);
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
      const wanted = commandsWanted(state);
      if (!wanted) target.selection = [];
      const commands: CommandDescriptor[] =
        !wanted || target.selection.length > selectionLimit
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
    // A new plane's target is checked against the published snapshot as soon as the plane
    // mounts: Git refused its own new plane as "changed" while the snapshot waited 80 ms. So a
    // plane added or removed publishes at once, after a microtask in which its owner is
    // recorded; a path or view mode changing waits for the debounce.
    let live = true;
    let queued = false;
    const publishSoon = () => {
      clearTimeout(timer);
      timer = undefined;
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (live) publish();
      });
    };
    // the target follows the active plane, which no longer changes the registry
    let activePane = getState().activePane;
    let saved = getState().saved.workspaces;
    let shape = '';
    let planes = '';
    const unfollow = subscribe(() => {
      const state = getState();
      if (state.saved.workspaces !== saved) {
        saved = state.saved.workspaces;
        const snapshot = workspaceSnapshot(state);
        if (planeSet(snapshot) !== planes) {
          activePane = state.activePane;
          publishSoon();
          return;
        }
        if (JSON.stringify(snapshot) !== shape) {
          activePane = state.activePane;
          schedule();
          return;
        }
      }
      if (state.activePane !== activePane) {
        activePane = state.activePane;
        schedule();
      }
    });
    // Human commands can run as soon as the registry is ready. Their desktop
    // ownership and Chat context must exist before the first debounced update.
    publish();
    return () => {
      live = false;
      unsubscribe();
      unfollow();
      clearTimeout(timer);
    };
  }, [registry, controller, windowContext]);
}
