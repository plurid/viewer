import { memo, useMemo } from 'react';
import type { FileEntry } from '../../domain/contracts';
import {
  folderInsights,
  insightLimit,
  type FolderInsight,
  type InsightID,
} from '../../domain/suggestions/insights';
import { dismissInsight, report, setActivePane, useViewer } from '../state/store';
import { useCommandRevision, useCommands } from '../commands/context';
import type { CommandRegistry, ResolvedCommand } from '../commands/registry';
import { Icon, type IconName } from '../ui/Icon';
import { IconButton } from '../ui/primitives';

interface InsightCard {
  insight: FolderInsight;
  /** What the action selects and runs on: none for a command on the whole folder. */
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
};
const none: readonly string[] = [];

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
 * A few cards above a folder's files, each pointing at something that may need attention. A card's
 * action selects the files concerned and runs the command a person would pick from the menu; a
 * card whose command does not apply to them is not shown.
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
  const enabled = useViewer((state) => state.settings.settings.browsing.insights);
  const home = useViewer((state) => state.bootstrap.home);
  const dismissed = useViewer((state) => state.saved.ui.insightsDismissed?.[folder]) ?? none;
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
  const cards = useMemo(
    () => applicable(registry, insights, entries, paneID, folder),
    // `revision` changes with what the plane's commands read
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registry, revision, insights, entries, paneID, folder],
  );
  if (!cards.length) return null;
  const run = ({ files, command }: InsightCard) => {
    setActivePane(paneID);
    select(files);
    void registry.run(command).catch(report);
  };
  return (
    <section className="folder-insights" aria-label="Insights">
      {cards.map((card) => (
        <article key={card.insight.id} className="folder-insight" data-insight={card.insight.id}>
          <Icon name={icons[card.insight.id]} size={16} />
          <div className="folder-insight-text">
            <strong>{card.insight.title}</strong>
            {card.insight.detail && <span>{card.insight.detail}</span>}
          </div>
          <button type="button" onClick={() => run(card)}>
            {/* a command that asks first says so, as its menu row does */}
            {card.insight.action + (card.command.label.endsWith('…') ? '…' : '')}
          </button>
          <IconButton
            icon="close"
            label={`Dismiss ${card.insight.title}`}
            className="folder-insight-dismiss"
            onClick={() => dismissInsight(folder, card.insight.id)}
          />
        </article>
      ))}
    </section>
  );
});
