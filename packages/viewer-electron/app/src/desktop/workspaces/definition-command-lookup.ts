import type { Workspace } from '../../domain/contracts';
import type { WorkspaceDefinition } from '../../domain/workspaces/definitions/schema';
import type { DefinitionCommandLookup } from './definition-commands';

interface LookupPorts {
  window(owner: number): { workspaceID?: string; workspaces: readonly Workspace[] } | undefined;
  definition(key: string): WorkspaceDefinition | undefined;
  defaultProfile(): string;
}

/** Persisted plane ownership and the current catalog are desktop authority, not renderer claims. */
export function definitionCommandLookup(ports: LookupPorts): DefinitionCommandLookup {
  return (owner, key, plane, workspaceID, terminalID) => {
    const window = ports.window(owner);
    if (!window || window.workspaceID !== workspaceID) return;
    const workspace = window.workspaces.find((item) => item.id === workspaceID);
    if (!workspace || workspace.definition?.key !== key) return;
    const pane = workspace.panes.find((item) => item.id === terminalID);
    if (pane?.type !== 'terminal' || pane.definitionPlane !== plane) return;
    const definition = ports.definition(key);
    const resolved = definition?.planes.find((item) => item.index === plane && item.index >= 0);
    if (!definition || resolved?.plane.kind !== 'terminal' || !resolved.plane.command) return;
    return {
      command: resolved.plane.command,
      cwd: resolved.plane.path,
      paneCwd: pane.path,
      profileID: resolved.plane.profileID ?? definition.terminalProfile ?? ports.defaultProfile(),
      workspaceName: definition.name,
      basis: definition.basis,
    };
  };
}
