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
import { Dialog, IconButton } from '../ui/primitives';
import { useFolder } from '../explorer/useFolder';
import { useSearch } from '../explorer/useSearch';
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
  const [subtree, setSubtree] = useState(false);
  const listing = useFolder(directory);
  const search = useSearch(
    directory,
    query.slice(0, 300),
    subtree,
    context.folder?.showHidden || false,
  );
  const sourceID = useMemo(() => `finder:${crypto.randomUUID()}`, []);
  const matches = useMemo(
    () =>
      rankFiles(
        (subtree && query.trim() ? search.entries : listing.entries).filter(
          (entry) => context.folder?.showHidden || !entry.hidden,
        ),
        query,
      ),
    [listing.entries, search.entries, subtree, query, context.folder?.showHidden],
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
        empty={listing.loading ? 'Reading folder…' : 'No matching files'}
        placeholder="Find by filename…"
        leading={<IconButton icon="left" label="Back to commands" onClick={onCommands} />}
      />
      <div className="palette-context">
        <span title={directory}>
          {context.selection.length ? `${context.selection.length} selected · ` : ''}
          {directory}
        </span>
        {
          <button aria-pressed={subtree} onClick={() => setSubtree(!subtree)}>
            Include subfolders
          </button>
        }
        {search.running && (
          <IconButton icon="pause" label="Cancel search" onClick={search.cancel} />
        )}
      </div>
      {listing.error && (
        <p className="inline-warning" role="alert">
          {listing.error}
        </p>
      )}
    </>
  );
}
