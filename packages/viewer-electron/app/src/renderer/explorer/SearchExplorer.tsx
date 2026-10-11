import { memo, useEffect, useMemo, useRef, useState } from 'react';
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
import { revealFile } from './anchors';
import { SelectionSize } from './sizes';
import { blankFileSpace, fileControlOwnsKey, useFileKeyboard, useFileSelection } from './selection';
import { editable } from '../commands/editing';
import { useCommands } from '../commands/context';
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
  const selecting = useFileSelection(session, select);
  const registry = useCommands();
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
          open: (entries, _linked, another) => {
            const origin = activeWorkspace().id;
            for (const entry of entries)
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
          },
          path: () => {},
          search: () => {},
          refresh: () => window.dispatchEvent(new Event('viewer:refresh')),
          selectAll: () => {
            selecting.all(entries);
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
  const handleKey = useFileKeyboard(id, (event) => {
    if (
      editable(event.target) ||
      fileControlOwnsKey(event) ||
      document.querySelector('dialog[open], .context-menu')
    )
      return;
    const mod = event.metaKey || event.ctrlKey;
    const invoke = (name: string) => {
      void registry.invoke(name, { paneID: id }).catch(report);
    };
    if (
      [
        'ArrowDown',
        'ArrowUp',
        'ArrowLeft',
        'ArrowRight',
        'Home',
        'End',
        'PageUp',
        'PageDown',
      ].includes(event.key)
    ) {
      event.preventDefault();
      event.stopPropagation();
      selecting.move(entries, event.key, event.shiftKey);
    } else if (mod && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      event.stopPropagation();
      selecting.all(entries);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      selecting.clear();
    } else {
      const command =
        event.key === ' '
          ? 'quick-preview'
          : event.key === 'Enter' && !mod
            ? 'rename'
            : mod
              ? (
                  { c: 'copy', x: 'cut', v: 'paste', o: 'open-selection', i: 'info' } as Record<
                    string,
                    string
                  >
                )[event.key.toLowerCase()]
              : undefined;
      if (command) {
        event.preventDefault();
        event.stopPropagation();
        invoke(command);
      }
    }
  });
  if (!pane) return <Empty title="Search is unavailable" />;
  const props: FileViewProps = {
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
    open: (entry) => {
      const origin = activeWorkspace().id;
      void revealFile(id, entry.path)
        .then((link) =>
          workspace.openPath(entry.path, {
            workspaceID: origin,
            paneID: id,
            linked: true,
            link,
          }),
        )
        .catch(report);
    },
    context: (entry, event) => {
      event.preventDefault();
      void refreshClipboard().catch(report);
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
      ref={surface}
      data-file-owner={id}
      onPointerDown={() => setActivePane(id)}
      onKeyDownCapture={handleKey}
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
        void refreshClipboard().catch(report);
        setMenu({
          x: event.clientX,
          y: event.clientY,
          request: { paneID: id, scope: 'folder', context: { selection: [] } },
        });
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
