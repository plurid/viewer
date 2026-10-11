import { memo, useEffect, useMemo, useState } from 'react';
import type { FileEntry, SearchPane } from '../../domain/contracts';
import {
  activeWorkspace,
  setActivePane,
  useViewer,
  report,
  getState,
  refreshClipboard,
} from '../state/store';
import { browseSession, useBrowseField } from '../workspace/sessions';
import { useWorkspace } from '../workspace/context';
import { useIndexedSearch } from './useIndexedSearch';
import { ListView, type FileViewProps } from './views';
import { ContextMenu } from '../ui/ContextMenu';
import { Empty, Loading } from '../ui/primitives';
import { useCommandSource } from '../commands/context';
import { folderCommands } from '../commands/folder';
import { useFileDialogs } from './FileDialogs';
import type { CommandRequest } from '../commands/registry';
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
          open: (entries, _linked, another) => {
            for (const entry of entries)
              void workspace
                .openPath(entry.path, {
                  workspaceID: activeWorkspace().id,
                  paneID: id,
                  linked: true,
                  another,
                })
                .catch(report);
          },
          path: () => {},
          search: () => {},
          refresh: () => window.dispatchEvent(new Event('viewer:refresh')),
          selectAll: () => {
            for (const entry of entries) session.cache.set(entry.path, entry);
            select(entries.map((file) => file.path));
          },
        }),
      valid: (context) => context.workspaceID === activeWorkspace().id,
    },
    [selected, recipes],
  );
  useEffect(() => {
    if (active !== id) return;
    const rootID = workspace.rootID(id);
    if (rootID)
      void window.viewer
        .contextPublish({
          workspaceID: activeWorkspace().id,
          paneID: id,
          rootID,
          sources: selected.map((file) => file.path),
          actor: 'user',
        })
        .catch(report);
  }, [active, id, selected, workspace]);
  if (!pane) return <Empty title="Search is unavailable" />;
  const props: FileViewProps = {
    entries,
    selection,
    selectionSet: set,
    showHidden: true,
    select: (entry, event) => {
      session.cache.set(entry.path, entry);
      setActivePane(id);
      event.currentTarget.closest<HTMLElement>('.search-explorer')?.focus({ preventScroll: true });
      const anchor = entries.findIndex((file) => file.path === session.anchor);
      const index = entries.findIndex((file) => file.path === entry.path);
      select(
        event.shiftKey && anchor >= 0
          ? entries
              .slice(Math.min(anchor, index), Math.max(anchor, index) + 1)
              .map((file) => file.path)
          : event.metaKey || event.ctrlKey
            ? selection.includes(entry.path)
              ? selection.filter((path) => path !== entry.path)
              : [...selection, entry.path]
            : [entry.path],
      );
      if (!event.shiftKey) session.anchor = entry.path;
    },
    open: (entry) => {
      void workspace
        .openPath(entry.path, { workspaceID: activeWorkspace().id, paneID: id, linked: true })
        .catch(report);
    },
    context: (entry, event) => {
      event.preventDefault();
      void refreshClipboard().catch(report);
      session.cache.set(entry.path, entry);
      if (!set.has(entry.path)) select([entry.path]);
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
      event.dataTransfer.setData('application/x-viewer-files', JSON.stringify(files));
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
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && entries.length) {
          event.preventDefault();
          const current = entries.findIndex((file) => file.path === selection.at(-1));
          const index =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? entries.length - 1
                : Math.min(
                    entries.length - 1,
                    Math.max(0, current + (event.key === 'ArrowDown' ? 1 : -1)),
                  );
          const file = entries[index];
          const anchor = entries.findIndex((file) => file.path === session.anchor);
          const targets =
            event.shiftKey && anchor >= 0
              ? entries.slice(Math.min(anchor, index), Math.max(anchor, index) + 1)
              : [file];
          for (const file of targets) session.cache.set(file.path, file);
          select(targets.map((file) => file.path));
          if (!event.shiftKey) session.anchor = file.path;
          event.currentTarget
            .querySelector<HTMLElement>(`[data-file-path="${CSS.escape(file.path)}"]`)
            ?.scrollIntoView({ block: 'nearest' });
        }
        if (event.key === 'Enter' && selected.length === 1) {
          event.preventDefault();
          fileDialogs.actions.dialog('rename', {
            scope: 'files',
            workspaceID: activeWorkspace().id,
            paneID: id,
            selection: selected,
            clipboard: getState().clipboard,
            jobs: getState().jobs,
          });
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
          event.preventDefault();
          for (const entry of entries) session.cache.set(entry.path, entry);
          select(entries.map((file) => file.path));
        }
      }}
    >
      <div className="search-row">
        <span>
          {pane.query}
          {pane.content && ' · Document text'}
        </span>
        <span className="toolbar-spacer" />
        <span>{pane.allLocations ? 'Indexed locations' : pane.path}</span>
      </div>
      <div className="file-head">
        <span>Name</span>
        <span>Date modified</span>
        <span>Kind</span>
        <span>Size</span>
      </div>
      {search.error ? (
        <Empty title="Search failed" detail={search.error} />
      ) : search.running && !entries.length ? (
        <Loading label="Searching…" />
      ) : !entries.length ? (
        <Empty
          title={search.result?.status.running ? 'Indexing these locations…' : 'No matching files'}
        />
      ) : (
        <ListView {...props} />
      )}
      <footer className="folder-status">
        <span>
          {search.result?.status.running
            ? 'Indexing in progress'
            : entries.length + ' results on this page'}
        </span>
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
