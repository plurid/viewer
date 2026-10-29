import { nativeOpening } from './opening';
import { memo, useMemo, useRef, useState } from 'react';
import type { FileEntry, SearchPane } from '../../domain/contracts';
import {
  activeWorkspace,
  setActivePane,
  useViewer,
  report,
  getState,
  refreshClipboard,
  updatePane,
} from '../state/store';
import { browseSession, useBrowseField } from '../workspace/sessions';
import { useWorkspace } from '../workspace/context';
import { useIndexedSearch } from './useIndexedSearch';
import { SearchCoverage } from './SearchCoverage';
import { indexedCoverage } from '../../domain/search/coverage';
import { ListView, type FileViewProps } from './views';
import { ContextMenu } from '../ui/ContextMenu';
import { Empty, Loading } from '../ui/primitives';
import { useCommandSource } from '../commands/context';
import { folderCommands } from '../commands/folder';
import { useFileDialogs } from './FileDialogs';
import { FileTable } from './FileTable';
import { FILE_DRAG, useFileDrop } from './file-drop';
import { revealFile } from './anchors';
import { SelectionSize } from './sizes';
import { blankFileSpace, useFileKeyboard, useFileSelection } from './selection';
import { routeExplorerInput } from './input';
import { useCommands } from '../commands/context';
import type { CommandRequest } from '../commands/registry';
import { useContextPublish } from './context-publish';
import { requestRefresh } from '../state/refresh';
const emptyEntries: FileEntry[] = [];
export const SearchExplorer = memo(function SearchExplorer({ id }: { id: string }) {
  const pane = useViewer((state) => activeWorkspace(state).panes.find((pane) => pane.id === id)) as
    SearchPane | undefined;
  const fileDialogs = useFileDialogs();
  const active = useViewer((state) => state.activePane);
  const workspace = useWorkspace();
  const [offset, setOffset] = useState(0);
  const [menu, setMenu] = useState<{ x: number; y: number; request: CommandRequest }>();
  const [selection, select] = useBrowseField(id, pane?.path || '', 'selection');
  const session = browseSession(id, pane?.path || '');
  const selecting = useFileSelection(session, select);
  const drops = useFileDrop(() => (pane?.allLocations ? undefined : pane?.path));
  const registry = useCommands();
  const opening = useViewer((state) => state.settings.settings.fileOpening);
  const contentRoots = useViewer((state) => state.settings.settings.search.contentRoots);
  const openEntry = (entry: FileEntry, linked = false, another = false) => {
    const evidence = search.result?.evidence?.find((hit) => hit.path === entry.path);
    if (evidence && !another) {
      void workspace.openEvidence(evidence, id).catch(report);
      return;
    }
    if (nativeOpening(entry, opening, linked)) {
      void window.viewer.openExternal(entry.path).catch(report);
      return;
    }
    const origin = activeWorkspace().id;
    void revealFile(id, entry.path)
      .then((link) =>
        workspace.openPath(entry.path, {
          workspaceID: origin,
          paneID: id,
          linked: true,
          another,
          link,
        }),
      )
      .catch(report);
  };
  const surface = useRef<HTMLDivElement>(null);
  const search = useIndexedSearch(
    pane?.query || '',
    pane?.allLocations ? undefined : pane?.path,
    !!pane,
    true,
    offset,
    pane?.content ?? false,
    pane?.recursive ?? true,
  );
  const entries = search.result?.entries || emptyEntries;
  const entryMap = useMemo(() => new Map(entries.map((entry) => [entry.path, entry])), [entries]);
  const selected = useMemo(
    () => selection.flatMap((path) => entryMap.get(path) || session.cache.get(path) || []),
    [selection, entryMap, session],
  );
  const set = useMemo(() => new Set(selection), [selection]);
  const recipes = useViewer((state) => state.settings.settings.recipes);
  useCommandSource(
    'folder:' + id,
    {
      context: () => ({
        scope: selected.length ? 'files' : 'folder',
        workspaceID: activeWorkspace().id,
        paneID: id,
        path: pane?.path,
        selection: selected,
        clipboard: getState().clipboard,
        jobs: getState().jobs,
      }),
      definitions: () =>
        folderCommands({
          ...fileDialogs.actions,
          open: (entries, linked, another) => {
            for (const entry of entries) openEntry(entry, linked, another);
          },
          path: () => {},
          search: () => {},
          refresh: () => requestRefresh(),
          selectAll: () => {
            if (!pane || (!offset && !search.result?.more)) {
              selecting.all(entries);
              return;
            }
            // Every indexed match across pages, each verified unchanged since indexing.
            void window.viewer
              .querySnapshot({
                query: pane.query,
                root: pane.allLocations ? undefined : pane.path,
                content: pane.content ?? false,
                recursive: pane.recursive ?? true,
                showHidden: true,
              })
              .then((snapshot) => selecting.all(snapshot.entries))
              .catch((error) => {
                selecting.all(entries);
                report(error);
              });
          },
          invertSelection: () => selecting.invert(entries),
        }),
      valid: (context) => context.workspaceID === activeWorkspace().id,
    },
    [selected, recipes, opening, offset, search.result?.more],
  );
  useContextPublish(id, active === id, selected);
  const handleKey = useFileKeyboard(id, (event) =>
    routeExplorerInput(event, {
      settings: getState().settings.settings,
      command: (name) => {
        void (async () => {
          if (name === 'paste' || name === 'paste-move') await refreshClipboard();
          await registry.invoke(name, { paneID: id });
        })().catch(report);
      },
      move: (key, range) => selecting.move(entries, key, range),
      clear: () => selecting.clear(),
      type: (text) => {
        selecting.type(entries, text);
      },
    }),
  );
  if (!pane) return <Empty title="Search is unavailable" />;
  const props: FileViewProps = {
    paneID: id,
    entries,
    selection,
    cursor: session.cursor,
    selectionSet: set,
    showHidden: true,
    select: (entry, event) => {
      setActivePane(id);
      surface.current?.focus({ preventScroll: true });
      selecting.click(entry, event, entries);
    },
    region: (found, base) => {
      setActivePane(id);
      selecting.region(found, base);
    },
    open: (entry) => openEntry(entry),
    context: (entry, event) => {
      event.preventDefault();
      void refreshClipboard(true);
      selecting.target(entry);
      setActivePane(id);
      setMenu({
        x: event.clientX,
        y: event.clientY,
        request: {
          paneID: id,
          scope: 'files',
          context: { selection: set.has(entry.path) ? selected : [entry] },
        },
      });
    },
    drag: (entry: FileEntry, event) => {
      const files = set.has(entry.path) ? selection : [entry.path];
      if (event.isTrusted) {
        event.preventDefault();
        void window.viewer.fileDragStart(files).catch(report);
        return;
      }
      event.dataTransfer.setData(FILE_DRAG, JSON.stringify(files));
      event.dataTransfer.setData('text/plain', files.join('\n'));
      event.dataTransfer.effectAllowed = 'copyMove';
    },
  };
  return (
    <div
      className="folder-explorer search-explorer"
      tabIndex={0}
      aria-label={pane.name}
      onFocus={() => setActivePane(id)}
      ref={surface}
      data-file-owner={id}
      onPointerDown={() => setActivePane(id)}
      onKeyDownCapture={handleKey}
      {...drops}
      onClick={(event) => {
        if (
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          blankFileSpace(event.target)
        ) {
          selecting.clear();
          surface.current?.focus({ preventScroll: true });
        }
      }}
      onContextMenu={(event) => {
        if (!blankFileSpace(event.target)) return;
        event.preventDefault();
        setActivePane(id);
        void refreshClipboard(true);
        setMenu({
          x: event.clientX,
          y: event.clientY,
          request: { paneID: id, scope: 'folder', context: { selection: [] } },
        });
      }}
    >
      <div className="search-row">
        <input
          aria-label="Search query"
          value={pane.query}
          onChange={(event) => {
            setOffset(0);
            updatePane(id, { query: event.target.value });
          }}
        />
        <label className="search-content-option">
          <input
            type="checkbox"
            checked={pane.content ?? false}
            onChange={(event) => {
              setOffset(0);
              updatePane(id, { content: event.target.checked });
            }}
          />
          Document text
        </label>
        <span>{pane.allLocations ? 'Indexed locations' : pane.path}</span>
      </div>
      <SearchCoverage
        result={search.result}
        request={{
          query: pane.query,
          root: pane.allLocations ? undefined : pane.path,
          content: pane.content,
          recursive: pane.recursive,
          showHidden: true,
        }}
      />
      <FileTable paneID={id}>
        {search.error ? (
          <Empty title="Search failed" detail={search.error} />
        ) : search.running && !entries.length ? (
          <Loading label="Searching…" />
        ) : !entries.length ? (
          <Empty
            title={
              !search.result ||
              indexedCoverage(
                search.result,
                { root: pane.allLocations ? undefined : pane.path, content: pane.content },
                contentRoots,
              ).state !== 'complete'
                ? 'No matches in the available search data'
                : 'No matching files'
            }
            detail="Expand search coverage above to see locations, exclusions and limits."
          />
        ) : (
          <ListView {...props} />
        )}
      </FileTable>
      {pane.content &&
        selected.length === 1 &&
        (() => {
          const hit = search.result?.evidence?.find((hit) => hit.path === selected[0]?.path);
          return hit ? (
            <div className="search-evidence">
              <button
                onClick={() => {
                  void workspace.openEvidence(hit, id).catch(report);
                }}
              >
                {hit.anchor.kind === 'pdf'
                  ? 'Page ' + hit.anchor.page
                  : hit.anchor.kind === 'epub'
                    ? 'Chapter ' + (hit.anchor.chapter + 1)
                    : hit.anchor.kind === 'text'
                      ? 'Line ' + hit.anchor.line
                      : hit.anchor.kind === 'document'
                        ? 'Passage ' + (hit.anchor.block + 1)
                        : 'Open source location'}
              </button>
              <p>{hit.quote}</p>
              {hit.coverage === 'partial' && <span className="muted">Partially indexed</span>}
            </div>
          ) : (
            <div className="search-evidence muted">
              No source passage is available for this match.
            </div>
          );
        })()}
      <footer className="folder-status">
        <span>
          {search.result?.status.running
            ? 'Indexing in progress'
            : entries.length + ' results on this page'}
          {selection.length ? ` · ${selection.length} selected` : ''}
        </span>
        <SelectionSize entries={selected} />
        <div>
          <button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 150))}>
            Previous
          </button>
          <button disabled={!search.result?.more} onClick={() => setOffset(offset + 150)}>
            Next
          </button>
        </div>
      </footer>
      {menu && (
        <ContextMenu
          position={menu}
          request={menu.request}
          label="Search result actions"
          onClose={() => setMenu(undefined)}
        />
      )}
      {fileDialogs.content}
    </div>
  );
});
