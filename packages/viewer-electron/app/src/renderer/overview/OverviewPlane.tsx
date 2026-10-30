import { useEffect, useState } from 'react';
import type { FileEntry, OverviewPane as Pane } from '../../domain/contracts';
import type { IndexedResult } from '../../domain/services';
import type { IndexStatus } from '../../domain/services';
import { formatBytes } from '../../domain/files/entries';
import { errorMessage } from '../../domain/errors';
import {
  extractedChecks,
  extractedFolder,
  overviewQueries,
  overviewRoot,
  summarize,
  type OverviewQuery,
  type OverviewSummary,
} from '../../domain/suggestions/overview';
import { report, useViewer } from '../state/store';
import { saveCollection } from '../state/collections';
import { useWorkspace } from '../workspace/context';
import { Empty, IconButton } from '../ui/primitives';
import './overview.css';

type Card =
  | { kind: 'loading' }
  /** `paths`: a checked card's own matches, which Show all opens as a collection */
  | { kind: 'ready'; summary: OverviewSummary; paths?: string[] }
  | { kind: 'unindexed' }
  | { kind: 'failed'; message: string };

/** Matches a card reads: enough to count and to name the largest, never the whole index. */
const limit = 200;
const placeName = { downloads: 'Downloads', desktop: 'Desktop' } as const;
/** The collection a checked card's Show all opens, replaced each time. */
const extractedCollection = 'f3c1a9d2-4b6e-4c8a-9d1e-2a7b5c3e8f40';

/** Archives whose folder is beside them: a look at each candidate's folder, current on disk. */
async function extracted(result: IndexedResult): Promise<Card> {
  const candidates = result.entries
    .map((entry) => ({ entry, folder: extractedFolder(entry) }))
    .filter((item): item is { entry: FileEntry; folder: string } => !!item.folder);
  const checked = candidates.slice(0, extractedChecks);
  const found = await Promise.all(
    checked.map(({ entry, folder }) =>
      window.viewer.stat(folder).then(
        (info) => (info.directory ? entry : undefined),
        // gone, or outside the folders Viewer may read
        () => undefined,
      ),
    ),
  );
  const pairs = found.filter((entry): entry is FileEntry => !!entry);
  return {
    kind: 'ready',
    summary: summarize(pairs, result.more || candidates.length > checked.length),
    paths: pairs.map((entry) => entry.path),
  };
}

/**
 * What may need a look across the indexed locations, as cards of searches. A card counts its
 * matches and names a few; Show all opens them as a search, where selection and every command
 * work as usual. The plane itself changes nothing.
 */
export default function OverviewPlane({ pane }: { pane: Pane }) {
  const workspace = useWorkspace();
  const home = useViewer((state) => state.bootstrap.home);
  const [cards, setCards] = useState<Record<string, Card>>({});
  const [status, setStatus] = useState<IndexStatus>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setCards({});
    void window.viewer.indexStatus().then((value) => {
      if (live) setStatus(value);
    }, report);
    for (const item of overviewQueries)
      void window.viewer
        .indexedQuery({
          query: item.query,
          root: overviewRoot(item.place, home),
          limit,
          recursive: true,
        })
        .then((result): Card | Promise<Card> =>
          !result.indexed
            ? { kind: 'unindexed' }
            : item.check === 'extracted'
              ? extracted(result)
              : { kind: 'ready', summary: summarize(result.entries, result.more, item.order) },
        )
        .catch((error: unknown): Card => ({ kind: 'failed', message: errorMessage(error) }))
        .then((card) => {
          if (live) setCards((current) => ({ ...current, [item.id]: card }));
        });
    return () => {
      live = false;
    };
  }, [home, revision]);
  const showAll = (item: OverviewQuery) => {
    const card = cards[item.id];
    if (card?.kind === 'ready' && card.paths) {
      // matches no query names: they open as a collection of exactly these files
      saveCollection({
        id: extractedCollection,
        name: item.title,
        kind: 'explicit',
        sources: card.paths,
      });
      workspace.openCollection(extractedCollection);
      return;
    }
    workspace.newSearch(item.query, item.title, overviewRoot(item.place, home), true);
  };
  const open = (path: string) =>
    void workspace.openPath(path, { paneID: pane.id, linked: true, activate: true }).catch(report);
  const searchSettings = () => void window.viewer.openSettings('settings.search').catch(report);
  if (status && !status.roots.length)
    return (
      <Empty
        icon="search"
        title="Nothing indexed yet"
        detail="Overview reads the filename index. Choose the folders to index in Settings → Search."
      >
        <button onClick={searchSettings}>Open Search settings</button>
      </Empty>
    );
  const found = overviewQueries.filter((item) => {
    const card = cards[item.id];
    return card?.kind !== 'ready' || card.summary.count > 0;
  });
  const clear = overviewQueries.filter((item) => {
    const card = cards[item.id];
    return card?.kind === 'ready' && card.summary.count === 0;
  });
  return (
    <section className="overview-plane" aria-label="File overview">
      <header className="overview-toolbar">
        <span className="muted" role="status">
          {status
            ? `${status.count.toLocaleString()} items indexed in ${status.roots.length} ${status.roots.length === 1 ? 'location' : 'locations'}${status.running ? ' · indexing' : ''}`
            : 'Reading the index…'}
        </span>
        <span className="overview-space" />
        <button onClick={searchSettings}>Search settings</button>
        <IconButton
          icon="refresh"
          label="Refresh"
          onClick={() => setRevision((value) => value + 1)}
        />
      </header>
      <div className="overview-cards">
        {found.map((item) => (
          <OverviewCard
            key={item.id}
            item={item}
            card={cards[item.id] ?? { kind: 'loading' }}
            showAll={() => showAll(item)}
            open={open}
            searchSettings={searchSettings}
          />
        ))}
      </div>
      {!!clear.length && (
        <p className="overview-clear muted">
          No matches: {clear.map((item) => item.title).join(', ')}.
        </p>
      )}
    </section>
  );
}

function OverviewCard({
  item,
  card,
  showAll,
  open,
  searchSettings,
}: {
  item: OverviewQuery;
  card: Card;
  showAll(): void;
  open(path: string): void;
  searchSettings(): void;
}) {
  return (
    <article className="overview-card" data-overview={item.id} aria-busy={card.kind === 'loading'}>
      <header>
        <strong>{item.title}</strong>
        {card.kind === 'ready' && (
          <span className="overview-count">
            {card.summary.count.toLocaleString()}
            {card.summary.more ? '+' : ''} · {formatBytes(card.summary.bytes)}
            {card.summary.more ? '+' : ''}
          </span>
        )}
      </header>
      <p className="muted">{item.detail}</p>
      {card.kind === 'ready' && (
        <ul className="overview-files" aria-label={item.title}>
          {card.summary.top.map((entry) => (
            <li key={entry.path}>
              <button type="button" title={entry.path} onClick={() => open(entry.path)}>
                {entry.name}
              </button>
              <span className="muted">{formatBytes(entry.size)}</span>
            </li>
          ))}
        </ul>
      )}
      {card.kind === 'unindexed' && item.place !== 'everywhere' && (
        <p>{placeName[item.place]} is not in the filename index.</p>
      )}
      {card.kind === 'failed' && <p role="alert">{card.message}</p>}
      <footer>
        {card.kind === 'ready' && <button onClick={showAll}>Show all</button>}
        {card.kind === 'unindexed' && (
          <>
            <button onClick={showAll}>Search it now</button>
            <button onClick={searchSettings}>Add to the index</button>
          </>
        )}
      </footer>
    </article>
  );
}
