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
import { useContextPublish } from './context-publish';
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
      if (collection.kind === 'tag')
        items.push(...(await window.viewer.taggedFiles(collection.tag ?? '', collection.sources)));
      else if (collection.kind === 'query')
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
              if (file === undefined) break;
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
  // A query collection is a smart folder: it follows the index and file changes.
  const live = collection?.kind === 'query' || collection?.kind === 'tag';
  useEffect(() => {
    if (!live) return;
    let last = 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    const again = () => {
      clearTimeout(timer);
      // At most every two seconds while indexing runs.
      timer = setTimeout(
        () => {
          last = Date.now();
          setRefresh((value) => value + 1);
        },
        Math.max(0, 2000 - (Date.now() - last)),
      );
    };
    const stop = window.viewer.onEvent((event) => {
      if (event.type === 'index') again();
    });
    window.addEventListener('viewer:refresh', again);
    return () => {
      clearTimeout(timer);
      stop();
      window.removeEventListener('viewer:refresh', again);
    };
  }, [live]);
  const selected = useMemo(
    () => entries.filter((entry) => selection.includes(entry.path)),
    [entries, selection],
  );
  useContextPublish(id, active === id, selected);
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
    paneID: id,
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
    region: (found, base) => {
      setActivePane(id);
      selecting.region(found, base);
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
          {collection.kind === 'query'
            ? collection.query
            : collection.kind === 'tag'
              ? 'Tagged “' + collection.tag + '”'
              : 'Explicit collection'}
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
        {busy && !entries.length ? (
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
            ? 'Smart folder · follows indexed matches'
            : collection.kind === 'tag'
              ? 'Smart folder · follows Finder tags'
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
