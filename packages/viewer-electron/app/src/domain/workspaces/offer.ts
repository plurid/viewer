import type { Workspace } from '../contracts';
import type { WorkspaceDefinition } from './definitions/schema';
import { searchableDefinition } from './definitions/query';
import { definitionLinkMatches, richDefinition } from './catalog';
import { mostlyIn, owningDefinition } from './ownership';

/** What opening the definition adds to browsing its folder. */
export type WorkspaceOfferReason = 'open-elsewhere' | 'remembered' | 'rich';

/**
 * The workspace a folder belongs to, offered while browsing it: switching to the workspace already
 * open for it, or opening its definition. The command is the row Change workspace… lists for it.
 */
export type WorkspaceOffer =
  | {
      reason: 'open-elsewhere';
      definition: WorkspaceDefinition;
      /** The open workspace linked to the definition. */
      workspace: Workspace;
      command: `workspace:${string}`;
    }
  | {
      reason: 'remembered' | 'rich';
      definition: WorkspaceDefinition;
      command: `defined:${string}`;
    };

/** Whether the workspace is linked to the definition, as a plain answer that narrows nothing. */
const linkedTo = (space: Workspace, definition: WorkspaceDefinition): boolean =>
  definitionLinkMatches(space, definition);

export interface WorkspaceOfferInput {
  /** The folder in view. */
  folder: string;
  /** The workspace the folder is viewed in. */
  current: Workspace;
  /** Every open workspace, the current one included. */
  workspaces: readonly Workspace[];
  /** The catalog's definitions, in catalog order: its root index is kept per array. */
  definitions: readonly WorkspaceDefinition[];
}

/**
 * The deepest definition root holding the folder, when opening it adds something to what the
 * person already has: the workspace open for it elsewhere, its remembered planes or a rich
 * definition. A plain definition opens one folder plane at its root, which browsing already gives,
 * so it is not offered. Nothing is offered when the current workspace is linked to that definition
 * or mostly in its root, as it already is that workspace.
 */
export function workspaceOffer(input: WorkspaceOfferInput): WorkspaceOffer | undefined {
  const definition = owningDefinition(input.folder, input.definitions);
  if (!definition || !searchableDefinition(definition)) return;
  if (linkedTo(input.current, definition)) return;
  if (mostlyIn(input.current, input.definitions)?.key === definition.key) return;
  const open = input.workspaces.find(
    (space) => space.id !== input.current.id && linkedTo(space, definition),
  );
  if (open)
    return {
      reason: 'open-elsewhere',
      definition,
      workspace: open,
      command: `workspace:${open.id}`,
    };
  if (definition.remembered?.planes)
    return { reason: 'remembered', definition, command: `defined:${definition.key}` };
  if (richDefinition(definition))
    return { reason: 'rich', definition, command: `defined:${definition.key}` };
}
