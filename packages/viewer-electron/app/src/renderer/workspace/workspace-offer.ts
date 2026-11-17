import { useMemo } from 'react';
import type { Workspace } from '../../domain/contracts';
import type { WorkspaceDefinition } from '../../domain/workspaces/definitions/schema';
import type { WorkspaceInsight } from '../../domain/suggestions/insights';
import { workspaceInsight } from '../../domain/suggestions/insights';
import { workspaceOffer } from '../../domain/workspaces/offer';
import { activeWorkspace, useViewer } from '../state/core';

type Dismissed = Readonly<Record<string, readonly string[]>> | undefined;

/** The id a dismissed offer keeps under its root in `ui.insightsDismissed`. */
export const workspaceOfferID = 'workspace.open';

/** The offer for a folder in the current workspace, unless the person dismissed it for its root. */
export function offerFor(
  folder: string | undefined,
  current: Workspace,
  workspaces: readonly Workspace[],
  definitions: readonly WorkspaceDefinition[] | undefined,
  dismissed: Dismissed,
): WorkspaceInsight | undefined {
  // definitions hold local roots: a server location belongs to none
  if (!folder?.startsWith('/') || !definitions?.length) return;
  const offer = workspaceOffer({ folder, current, workspaces, definitions });
  if (!offer || dismissed?.[offer.definition.root]?.includes(workspaceOfferID)) return;
  return workspaceInsight(offer);
}

/**
 * The workspace offer for the folder in view (domain/workspaces/offer.ts): a folder plane's card
 * and the palette's Suggested section show the same one.
 */
export function useWorkspaceOffer(folder: string | undefined): WorkspaceInsight | undefined {
  const definitions = useViewer((state) => state.bootstrap.definitions?.definitions);
  const workspaces = useViewer((state) => state.saved.workspaces);
  const current = useViewer((state) => activeWorkspace(state));
  const dismissed = useViewer((state) => state.saved.ui.insightsDismissed);
  return useMemo(
    () => offerFor(folder, current, workspaces, definitions, dismissed),
    [folder, current, workspaces, definitions, dismissed],
  );
}
