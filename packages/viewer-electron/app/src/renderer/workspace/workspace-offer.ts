import { useMemo } from 'react';
import type { Workspace } from '../../domain/contracts';
import type { WorkspaceDefinition } from '../../domain/workspaces/definitions/schema';
import type { WorkspaceInsight } from '../../domain/suggestions/insights';
import { workspaceInsight } from '../../domain/suggestions/insights';
import { workspaceOffer } from '../../domain/workspaces/offer';
import { activeWorkspace, getState, useViewer } from '../state/core';
import { receiveDefinitions } from '../state/definitions';

/** The offer for a folder in the current workspace, unless the person dismissed it for its root. */
export function offerFor(
  folder: string | undefined,
  current: Workspace,
  workspaces: readonly Workspace[],
  definitions: readonly WorkspaceDefinition[] | undefined,
  dismissed: readonly string[] | undefined,
): WorkspaceInsight | undefined {
  // definitions hold local roots: a server location belongs to none
  if (!folder?.startsWith('/') || !definitions?.length) return;
  const offer = workspaceOffer({ folder, current, workspaces, definitions });
  if (!offer || dismissed?.includes(offer.definition.root)) return;
  return workspaceInsight(offer);
}

/**
 * Dismisses the offer for its root, everywhere it shows, in the desktop's private list. The card
 * leaves only once the list is saved; a failed save throws and the card stays.
 */
export async function dismissOffer(root: string): Promise<void> {
  receiveDefinitions(
    await window.viewer.workspaceDefinitionFile({ kind: 'dismiss-offers', roots: [root] }),
  );
}

/** Show Hidden Insights: every dismissed workspace offer shows again. */
export async function showHiddenOffers(): Promise<void> {
  receiveDefinitions(await window.viewer.workspaceDefinitionFile({ kind: 'show-offers' }));
}

/**
 * The workspace offer for the folder in view (domain/workspaces/offer.ts): a files plane's card
 * and the palette's Suggested section show the same one.
 */
export function useWorkspaceOffer(folder: string | undefined): WorkspaceInsight | undefined {
  const definitions = useViewer((state) => state.bootstrap.definitions?.definitions);
  const dismissed = useViewer((state) => state.bootstrap.definitions?.dismissedOffers);
  const workspaces = useViewer((state) => state.saved.workspaces);
  const current = useViewer((state) => activeWorkspace(state));
  return useMemo(
    () => offerFor(folder, current, workspaces, definitions, dismissed),
    [folder, current, workspaces, definitions, dismissed],
  );
}

/** Whether the person dismissed any workspace offer, so Show Hidden Insights has one to show. */
export function hasHiddenOffers(): boolean {
  return !!getState().bootstrap.definitions?.dismissedOffers?.length;
}
