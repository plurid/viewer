import { useMemo, useState } from 'react';
import { CommandResults } from './CommandResults';
import { useCommands, useCommandRevision, useCommandSource } from './context';
import {
  rankCommands,
  rankFiles,
  type CommandContext,
  type CommandDefinition,
  type ResolvedCommand,
} from './registry';
import { parentPath } from './folder';
import { activeWorkspace, getState, report, useViewer } from '../state/store';
import { Dialog, IconButton, NameDialog } from '../ui/primitives';
import { useFolder } from '../explorer/useFolder';
import { useSearch } from '../explorer/useSearch';
import { useIndexedSearch } from '../explorer/useIndexedSearch';
import { useWorkspace } from '../workspace/context';

export function CommandPalette({
  mode,
  onMode,
  onClose,
}: {
  mode: 'commands' | 'files';
  onMode(mode: 'commands' | 'files'): void;
  onClose(): void;
}) {
  const registry = useCommands();
  useCommandRevision();
  const active = useViewer((state) => state.activePane);
  const context = registry.context(active)!;
  const directory =
    context.directory || (context.path ? parentPath(context.path) : getState().bootstrap.home);
  return (
    <Dialog
      title={mode === 'files' ? 'Find file' : 'Commands'}
      onClose={onClose}
      className="command-palette"
    >
      {mode === 'files' ? (
        <FileFinder
          key={`${context.workspaceID}:${active}:${directory}`}
          context={context}
          directory={directory}
          onCommands={() => onMode('commands')}
          onClose={onClose}
        />
      ) : (
        <CommandFinder context={context} active={active} directory={directory} onClose={onClose} />
      )}
    </Dialog>
  );
}

function CommandFinder({
  context,
  active,
  directory,
  onClose,
}: {
  context: CommandContext;
  active: string;
  directory: string;
  onClose(): void;
}) {
  const registry = useCommands();
  useCommandRevision();
  const recent = useViewer((state) => state.saved.ui.recentCommands);
  const [query, setQuery] = useState('');
  const rows = rankCommands(
    registry.list({ paneID: active, scope: 'window', context }),
    query,
    recent,
    'palette',
  );
  return (
    <>
      <CommandResults
        query={query}
        onQuery={setQuery}
        rows={rows}
        onClose={onClose}
        label="Search commands"
        placeholder="Search commands and places…"
        recent={recent.filter((id) => rows.some((row) => row.id === id)).slice(0, 2)}
        onSelect={(command) => {
          onClose();
          requestAnimationFrame(() => {
            void registry.run(command).catch(report);
          });
        }}
      />
      <div className="palette-context">
        <span title={directory}>
          {context.selection.length ? `${context.selection.length} selected · ` : ''}
          {directory}
        </span>
      </div>
    </>
  );
}

/** File listing, watches and recursive search exist only while the file finder is open. */
function FileFinder({
  context,
  directory,
  onCommands,
  onClose,
}: {
  context: CommandContext;
  directory: string;
  onCommands(): void;
  onClose(): void;
}) {
  const registry = useCommands();
  const workspace = useWorkspace();
  useCommandRevision();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'folder' | 'subfolders' | 'all'>('folder');
  const subtree = scope === 'subfolders';
  const [saving, setSaving] = useState(false);
  const [content, setContent] = useState(false);
  const indexedMode = scope === 'all' || content;
  const contentRoots = useViewer((state) => state.settings.settings.search.contentRoots);
  const indexed = useIndexedSearch(
    query,
    scope === 'all' ? undefined : directory,
    indexedMode,
    context.folder?.showHidden || false,
    0,
    content,
    scope !== 'folder',
  );
  const listing = useFolder(directory);
  const search = useSearch(
    directory,
    query.slice(0, 300),
    subtree && !content,
    context.folder?.showHidden || false,
  );
  const sourceID = useMemo(() => `finder:${crypto.randomUUID()}`, []);
  const matches = useMemo(
    () =>
      indexedMode
        ? indexed.result?.entries || []
        : subtree && query.trim()
          ? search.entries
          : rankFiles(
              listing.entries.filter((entry) => context.folder?.showHidden || !entry.hidden),
              query,
            ),
    [
      listing.entries,
      search.entries,
      indexed.result,
      scope,
      indexedMode,
      subtree,
      query,
      context.folder?.showHidden,
    ],
  );
  const fileCommands: CommandDefinition[] = matches.map((entry) => ({
    id: `find-result:${entry.path}`,
    label: entry.name,
    group: 'Files',
    icon: entry.directory ? 'folder' : 'file',
    detail: entry.parent === directory ? undefined : entry.parent,
    primary: true,
    remember: false,
    when: () => true,
    run: async () => {
      const resolved = await window.viewer.stat(entry.path);
      if (activeWorkspace().id !== context.workspaceID) return;
      await workspace.openPath(resolved.path, {
        paneID: context.paneID,
        workspaceID: context.workspaceID,
      });
    },
  }));
  useCommandSource(
    sourceID,
    {
      context: () => context,
      definitions: () => fileCommands,
      valid: (invocation) => invocation.workspaceID === activeWorkspace().id,
    },
    [matches],
  );
  const rows = registry.list({ sources: [sourceID] });
  const select = (command: ResolvedCommand) => {
    // Capture its handler before close releases the ephemeral source.
    void registry.run(command).catch(report);
    onClose();
  };
  return (
    <>
      <CommandResults
        query={query}
        onQuery={setQuery}
        rows={rows}
        onSelect={select}
        onClose={onClose}
        label="Find file by name"
        empty={
          (indexedMode ? indexed.running : subtree ? search.running : listing.loading)
            ? 'Searching…'
            : 'No matching files'
        }
        placeholder={content ? 'Find in indexed document text…' : 'Find by filename…'}
        leading={<IconButton icon="left" label="Back to commands" onClick={onCommands} />}
      />
      <div className="palette-context">
        <span title={directory}>
          {context.selection.length ? `${context.selection.length} selected · ` : ''}
          {directory}
        </span>
        <select
          aria-label="Search scope"
          value={scope}
          onChange={(event) => setScope(event.target.value as typeof scope)}
        >
          <option value="folder">This folder</option>
          <option value="subfolders">Subfolders</option>
          <option value="all">Indexed locations</option>
        </select>
        <label className="search-content-option">
          <input
            type="checkbox"
            checked={content}
            onChange={(event) => setContent(event.target.checked)}
          />
          Document text
        </label>
        <button
          disabled={!query.trim()}
          onClick={() => {
            workspace.newSearch(
              query,
              query,
              scope === 'all' ? undefined : directory,
              scope !== 'folder',
              content,
            );
            onClose();
          }}
        >
          Open results
        </button>
        <button disabled={!query.trim()} onClick={() => setSaving(true)}>
          Save search…
        </button>
        {search.running && (
          <IconButton icon="pause" label="Cancel search" onClick={search.cancel} />
        )}
      </div>
      {content && !contentRoots.length && (
        <p className="inline-warning">
          Document text indexing is off. Enable it for a location in Settings → Search.
        </p>
      )}
      {content && indexed.result?.indexed === false && (
        <p className="inline-warning">This folder is outside the indexed locations.</p>
      )}
      {(indexed.result?.status.running || search.running) && (
        <p className="inline-warning">
          Indexing or search in progress · results may be incomplete.
        </p>
      )}
      {indexed.error && indexedMode && (
        <p className="inline-warning" role="alert">
          {indexed.error}
        </p>
      )}
      {saving && (
        <NameDialog
          title="Save search"
          action="Save"
          initial={query}
          onClose={() => setSaving(false)}
          onSubmit={async (name) => {
            const state = getState();
            await window.viewer.settingsPatch(
              [
                {
                  path: 'settings.savedSearches',
                  value: [
                    ...state.settings.settings.savedSearches,
                    {
                      id: crypto.randomUUID(),
                      name,
                      query,
                      root: scope === 'all' ? undefined : directory,
                      recursive: scope !== 'folder',
                      content,
                    },
                  ],
                },
              ],
              state.settings.revision,
            );
          }}
        />
      )}
      {listing.error && (
        <p className="inline-warning" role="alert">
          {listing.error}
        </p>
      )}
    </>
  );
}
