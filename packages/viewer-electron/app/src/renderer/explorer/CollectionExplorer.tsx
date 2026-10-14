import { useEffect, useMemo, useRef, useState } from 'react';
import type { CollectionPane, FileEntry } from '../../domain/contracts';
import {
  activeWorkspace,
  getState,
  setActivePane,
  useViewer,
  report,
  basketEntries,
} from '../state/store';
import { useWorkspace } from '../workspace/context';
import { useBrowseField, browseSession } from '../workspace/sessions';
import { useCommandSource, useCommands } from '../commands/context';
import { routeExplorerInput } from './input';
import { folderCommands } from '../commands/folder';
import { useFileDialogs } from './FileDialogs';
import { useFileSelection, useFileKeyboard } from './selection';
import { ListView, type FileViewProps } from './views';
import { FileTable } from './FileTable';
import { ContextMenu } from '../ui/ContextMenu';
import type { CommandRequest } from '../commands/registry';
import { Loading, Empty } from '../ui/primitives';
import { sortEntries } from '../../domain/files';
export function CollectionExplorer({ id }: { id: string }) {
  const active = useViewer((state) => state.activePane);
  const pane = useViewer((state) => activeWorkspace(state).panes.find((pane) => pane.id === id)) as
    CollectionPane | undefined;
  const collection = useViewer((state) =>
    activeWorkspace(state).collections?.find((value) => value.id === pane?.collectionID),
  );
  const workspace = useWorkspace(),
    dialogs = useFileDialogs(),
    surface = useRef<HTMLDivElement>(null);
  const registry = useCommands();
  const [entries, setEntries] = useState<FileEntry[]>([]),
    [issues, setIssues] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [menu, setMenu] = useState<{ x: number; y: number; request: CommandRequest }>();
  const [selection, select] = useBrowseField(id, pane?.path ?? '', 'selection');
  const session = browseSession(id, pane?.path ?? '');
  const selecting = useFileSelection(session, select);
  useEffect(() => {
    if (!collection) return;
    let live = true;
    setBusy(true);
    setIssues([]);
    void (async () => {
      const items: FileEntry[] = [],
        errors: string[] = [];
      if (collection.kind === 'query')
        for (const root of collection.sources) {
          const snapshot = await window.viewer.querySnapshot({
            query: collection.query ?? '',
            root,
            content: collection.content ?? false,
            recursive: collection.recursive ?? true,
          });
          items.push(...snapshot.entries);
          if (items.length > 10000)
            throw new Error('Narrow this collection to at most 10,000 indexed matches.');
        }
      else {
        let cursor = 0;
        await Promise.all(
          Array.from({ length: Math.min(8, collection.sources.length) }, async () => {
            while (cursor < collection.sources.length) {
              const file = collection.sources[cursor++];
              try {
                items.push(await window.viewer.stat(file));
              } catch (error) {
                errors.push(file + ': ' + (error as Error).message);
              }
            }
          }),
        );
      }
      if (live) {
        setEntries(
          sortEntries([...new Map(items.map((item) => [item.path, item])).values()], 'name', false),
        );
        setIssues(errors);
      }
    })()
      .catch((error: Error) => {
        if (live) {
          setEntries([]);
          setIssues([error.message]);
        }
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [collection, refresh]);
  const selected = useMemo(
    () => entries.filter((entry) => selection.includes(entry.path)),
    [entries, selection],
  );
  useEffect(() => {
    if (active !== id) return;
    const rootID = workspace.rootID(id);
    if (!rootID) return;
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
  const set = new Set(selection);
  useCommandSource(
    'collection:' + id,
    {
      context: () => ({
        scope: selected.length ? 'files' : 'folder',
        workspaceID: activeWorkspace().id,
        paneID: id,
        path: pane?.path,
        directory: pane?.path,
        selection: selected,
        clipboard: getState().clipboard,
        jobs: getState().jobs,
      }),
      definitions: () =>
        folderCommands({
          ...dialogs.actions,
          open: (files, linked, another) =>
            files.forEach((file) => workspace.open(file, id, { another })),
          path: () => {},
          search: () => {},
          refresh: () => setRefresh((value) => value + 1),
          selectAll: () => selecting.all(entries),
          invertSelection: () => selecting.invert(entries),
        }),
      valid: (context) => context.workspaceID === activeWorkspace().id,
    },
    [selected, entries],
  );
  const key = useFileKeyboard(id, (event) =>
    routeExplorerInput(event, {
      settings: getState().settings.settings,
      command: (command) => {
        void registry.invoke(command, { paneID: id }).catch(report);
      },
      move: (key, range) => selecting.move(entries, key, range),
      clear: () => selecting.clear(),
      type: (text) => selecting.type(entries, text),
    }),
  );
  const props: FileViewProps = {
    entries,
    selection,
    selectionSet: set,
    cursor: session.cursor,
    showHidden: true,
    select: (entry, event) => {
      setActivePane(id);
      selecting.click(entry, event, entries);
      surface.current?.focus({ preventScroll: true });
    },
    open: (entry) => workspace.open(entry, id),
    context: (entry, event) => {
      event.preventDefault();
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
    drag: (entry, event) => {
      event.preventDefault();
      void window.viewer
        .fileDragStart(set.has(entry.path) ? selection : [entry.path])
        .catch(report);
    },
  };
  if (!pane || !collection) return <Empty title="Collection unavailable" />;
  return (
    <div
      className="folder-explorer collection-explorer"
      ref={surface}
      tabIndex={0}
      data-file-owner={id}
      onFocus={() => setActivePane(id)}
      onKeyDownCapture={key}
    >
      <div className="search-row">
        <strong>{collection.name}</strong>
        <span className="muted">
          {collection.kind === 'query' ? collection.query : 'Explicit collection'}
        </span>
        <span className="toolbar-spacer" />
        <button onClick={() => setRefresh((value) => value + 1)} disabled={busy}>
          Refresh
        </button>
        <button
          disabled={!entries.length || busy}
          onClick={() => basketEntries(selected.length ? selected : entries)}
        >
          {selected.length ? 'Add selection to basket' : 'Add collection to basket'}
        </button>
      </div>
      <FileTable paneID={id}>
        {busy ? (
          <Loading label="Reading collection…" />
        ) : entries.length ? (
          <ListView {...props} />
        ) : (
          <Empty title="No available files" />
        )}
      </FileTable>
      {issues.length > 0 && (
        <details className="collection-issues">
          <summary>{issues.length} unavailable locations</summary>
          {issues.slice(0, 100).map((issue, index) => (
            <p className="error" key={index}>
              {issue}
            </p>
          ))}
        </details>
      )}
      <footer className="folder-status">
        <span>
          {entries.length} files · {selected.length} selected
        </span>
        <span>
          {collection.kind === 'query'
            ? 'Snapshot of all indexed matches'
            : 'References keep files in their original folders'}
        </span>
      </footer>
      {menu && (
        <ContextMenu position={menu} request={menu.request} onClose={() => setMenu(undefined)} />
      )}{' '}
      {dialogs.content}
    </div>
  );
}
