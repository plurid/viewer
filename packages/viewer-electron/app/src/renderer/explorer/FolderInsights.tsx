import type { ReactNode } from 'react';
import { memo, useMemo } from 'react';
import type { FileEntry } from '../../domain/contracts';
import { firstRunStepsLeft } from '../../domain/preferences/first-run';
import { keyGlyphs } from '../../domain/preferences/keymap';
import { defaultShortcuts } from '../../domain/preferences/shortcuts';
import type { FolderInsight, InsightID, WorkspaceInsight } from '../../domain/suggestions/insights';
import { folderInsights, insightLimit } from '../../domain/suggestions/insights';
import { insideRoot } from '../../domain/workspaces/found/roots';
import {
  activeWorkspace,
  dismissFirstRunHint,
  dismissInsight,
  report,
  setActivePane,
  useViewer,
} from '../state/store';
import { effectiveWindowUI } from '../state/effective-ui';
import { useCommandRevision, useCommands } from '../commands/context';
import type { CommandRegistry, ResolvedCommand } from '../commands/registry';
import { useWorkspaceOffer } from '../workspace/workspace-offer';
import { Icon, type IconName } from '../ui/Icon';
import { PathLabel } from '../ui/PathLabel';
import { IconButton } from '../ui/primitives';

interface InsightCard {
  insight: FolderInsight | WorkspaceInsight;
  /** What the action selects and runs on: none for a command on the whole folder or window. */
  files: FileEntry[];
  command: ResolvedCommand;
}

const icons: Record<InsightID, IconName> = {
  'downloads.installers': 'disk',
  'archives.extracted': 'archive',
  'pdfs.large': 'pdf',
  'names.copies': 'copy',
  screenshots: 'image',
  'photos.heic': 'image',
  'workspace.open': 'dock',
};
const none: readonly string[] = [];
const isWorkspace = (insight: FolderInsight): insight is WorkspaceInsight =>
  insight.id === 'workspace.open';

/**
 * The workspace offer for this plane's folder, shown in the workspace's first folder plane inside
 * its root alone, so planes browsing one project do not repeat it.
 */
function useOfferCard(paneID: string, folder: string, enabled: boolean) {
  const offer = useWorkspaceOffer(enabled ? folder : undefined);
  const first = useViewer(
    (state) =>
      !!offer &&
      activeWorkspace(state).panes.find(
        (pane) => pane.type === 'folder' && insideRoot(offer.root, pane.path),
      )?.id === paneID,
  );
  return first ? offer : undefined;
}

/** The cards whose command applies to their files, three at most. */
function applicable(
  registry: CommandRegistry,
  insights: readonly FolderInsight[],
  entries: readonly FileEntry[],
  paneID: string,
  folder: string,
): InsightCard[] {
  if (!insights.length) return [];
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  return insights
    .flatMap((insight) => {
      const files =
        insight.target === 'files' ? insight.paths.flatMap((path) => byPath.get(path) ?? []) : [];
      const [command] = registry.list({
        paneID,
        ids: [insight.command],
        scope: insight.target,
        context: { paneID, selection: files, directory: folder },
      });
      return command ? [{ insight, files, command }] : [];
    })
    .slice(0, insightLimit);
}

/**
 * A new profile's first-run tips, in its workspace's first folder plane: the steps not used yet,
 * with the keys the palette answers to, and title dragging while planes move by their title.
 */
function useFirstRunTips(paneID: string): ReactNode {
  const hint = useViewer((state) => state.saved.ui.firstRunHint);
  const first = useViewer(
    (state) => activeWorkspace(state).panes.find((pane) => pane.type === 'folder')?.id === paneID,
  );
  // a cleared shortcut leaves no key to name
  const palette = useViewer(
    (state) => state.settings.settings.shortcuts.palette ?? defaultShortcuts.palette,
  );
  const frameAll = useViewer(
    (state) => state.settings.settings.shortcuts['frame-all'] ?? defaultShortcuts['frame-all'],
  );
  const multiple = useViewer((state) => activeWorkspace(state).panes.length > 1);
  const dragging = useViewer((state) => {
    const { space } = effectiveWindowUI(state);
    return space.planeHeaders && space.dragging;
  });
  const steps = useMemo(() => (first ? firstRunStepsLeft(hint) : []), [first, hint]);
  const tips = steps.flatMap((step) =>
    step === 'quick-preview' ? (
      <li key={step}>
        <kbd>Space</kbd> previews the selected file
      </li>
    ) : step === 'frame-all' ? (
      multiple && frameAll ? (
        <li key={step}>
          <kbd>{keyGlyphs(frameAll)}</kbd> brings all planes into view
        </li>
      ) : (
        []
      )
    ) : palette ? (
      <li key={step}>
        <kbd>{keyGlyphs(palette)}</kbd> finds any action
      </li>
    ) : (
      []
    ),
  );
  if (!tips.length) return null;
  return (
    <article className="folder-insight folder-tips" aria-label="Tips">
      <Icon name="info" size={16} />
      <ul className="folder-insight-text">
        {tips}
        {dragging && <li>Drag a plane’s title to move it</li>}
      </ul>
      <IconButton
        icon="close"
        label="Dismiss tips"
        className="folder-insight-dismiss"
        onClick={dismissFirstRunHint}
      />
    </article>
  );
}

/**
 * A few cards above a folder's files, each pointing at something that may need attention. A card's
 * action selects the files concerned and runs the command a person would pick from the menu; a
 * card whose command does not apply to them is not shown. A new profile's tips lead them.
 */
export const FolderInsights = memo(function FolderInsights({
  paneID,
  folder,
  entries,
  select,
}: {
  paneID: string;
  folder: string;
  entries: readonly FileEntry[];
  /** These items selected in the plane, and no others. */
  select(files: readonly FileEntry[]): void;
}) {
  const registry = useCommands();
  const revision = useCommandRevision(paneID);
  const tips = useFirstRunTips(paneID);
  const enabled = useViewer((state) => state.settings.settings.browsing.insights);
  const home = useViewer((state) => state.bootstrap.home);
  const dismissed = useViewer((state) => state.saved.ui.insightsDismissed?.[folder]) ?? none;
  const offer = useOfferCard(paneID, folder, enabled);
  // every insight, so one whose command does not apply leaves its place to the next
  const insights = useMemo(() => {
    if (!enabled) return [];
    // insights decorate the folder: one that fails on an unusual entry leaves it as it was
    try {
      return folderInsights({
        folder,
        entries,
        now: Date.now(),
        home,
        dismissed,
        limit: Infinity,
      });
    } catch {
      return [];
    }
  }, [enabled, folder, entries, home, dismissed]);
  // the offer leads, after the tips, within the same three cards
  const offered = useMemo(() => (offer ? [offer, ...insights] : insights), [offer, insights]);
  const cards = useMemo(
    () => applicable(registry, offered, entries, paneID, folder),
    // `revision` changes with what the plane's commands read
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registry, revision, offered, entries, paneID, folder],
  );
  const run = ({ insight, files, command }: InsightCard) => {
    // opening a workspace leaves this plane's selection as it was
    if (insight.target !== 'window') {
      setActivePane(paneID);
      select(files);
    }
    void registry.run(command).catch(report);
  };
  if (!cards.length && !tips) return null;
  return (
    <section className="folder-insights" aria-label="Insights">
      {tips}
      {cards.map((card) => (
        <article key={card.insight.id} className="folder-insight" data-insight={card.insight.id}>
          <Icon name={icons[card.insight.id]} size={16} />
          <div className="folder-insight-text">
            <strong>{card.insight.title}</strong>
            {isWorkspace(card.insight) ? (
              <PathLabel path={card.insight.root} />
            ) : (
              card.insight.detail && <span>{card.insight.detail}</span>
            )}
          </div>
          <button type="button" onClick={() => run(card)}>
            {/* a command that asks first says so, as its menu row does */}
            {card.insight.action + (card.command.label.endsWith('…') ? '…' : '')}
          </button>
          <IconButton
            icon="close"
            label={`Dismiss ${card.insight.title}`}
            className="folder-insight-dismiss"
            onClick={() =>
              isWorkspace(card.insight)
                ? dismissInsight(card.insight.root, card.insight.id)
                : dismissInsight(folder, card.insight.id)
            }
          />
        </article>
      ))}
    </section>
  );
});
