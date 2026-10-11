import { useEffect, useMemo, useState } from 'react';
import { CommandResults } from './CommandResults';
import { useCommands, useCommandRevision, useCommandSource } from './context';
import { rankCommands, type CommandDefinition, type ResolvedCommand } from './registry';
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
  const workspace = useWorkspace();
  useCommandRevision();
  const active = useViewer((state) => state.activePane);
  const recent = useViewer((state) => state.saved.ui.recentCommands);
  const context = registry.context(active)!;
  const directory =
    context.directory || (context.path ? parentPath(context.path) : getState().bootstrap.home);
  const [query, setQuery] = useState('');
  const [subtree, setSubtree] = useState(false);
  const listing = useFolder(directory);
  const search = useSearch(
    directory,
    query.slice(0, 300),
    mode === 'files' && subtree,
    context.folder?.showHidden || false,
  );
  const sourceID = useMemo(() => `finder:${crypto.randomUUID()}`, []);
  useEffect(() => {
    setQuery('');
  }, [mode]);
  const fileCommands: CommandDefinition[] = (
    subtree && query.trim() ? search.entries : listing.entries
  )
    .filter((entry) => context.folder?.showHidden || !entry.hidden)
    .map((entry) => ({
      id: `find-result:${entry.identity}:${entry.name}`,
      label: entry.name,
      group: 'Files',
      icon: entry.directory ? 'folder' : 'file',
      detail: entry.parent === directory ? undefined : entry.parent,
      primary: true,
      remember: false,
      when: () => mode === 'files',
      run: async () => {
        const resolved = await window.viewer.stat(entry.path);
        if (activeWorkspace().id !== context.workspaceID) return;
        await workspace.openPath(resolved.path);
      },
    }));
  useCommandSource(
    sourceID,
    {
      context: () => context,
      definitions: () => fileCommands,
      valid: (invocation) => invocation.workspaceID === activeWorkspace().id,
    },
    [listing.entries, search.entries, mode, subtree],
  );
  const rows =
    mode === 'files'
      ? rankCommands(registry.list({ sources: [sourceID] }), query, []).slice(0, 150)
      : rankCommands(
          registry.list({ paneID: active, scope: 'window', context }),
          query,
          recent,
          'palette',
        );
  const select = (command: ResolvedCommand) => {
    if (mode === 'files') {
      // The ephemeral finder source is released on close, so capture its handler now.
      void registry.run(command).catch(report);
      onClose();
    } else {
      onClose();
      requestAnimationFrame(() => {
        void registry.run(command).catch(report);
      });
    }
  };
  const applicableRecent = recent
    .filter((id) => rows.some((command) => command.id === id))
    .slice(0, 2);
  return (
    <Dialog
      title={mode === 'files' ? 'Find file' : 'Commands'}
      onClose={onClose}
      className="command-palette"
    >
      <CommandResults
        query={query}
        onQuery={setQuery}
        rows={rows}
        onSelect={select}
        onClose={onClose}
        label={mode === 'files' ? 'Find file by name' : 'Search commands'}
        empty={
          mode === 'files'
            ? listing.loading
              ? 'Reading folder…'
              : 'No matching files'
            : 'No matching actions'
        }
        placeholder={mode === 'files' ? 'Find by filename…' : 'Search commands and places…'}
        recent={mode === 'commands' ? applicableRecent : []}
        leading={
          mode === 'files' ? (
            <IconButton icon="left" label="Back to commands" onClick={() => onMode('commands')} />
          ) : undefined
        }
      />
      <div className="palette-context">
        <span title={directory}>
          {context.selection.length ? `${context.selection.length} selected · ` : ''}
          {directory}
        </span>
        {mode === 'files' && (
          <button aria-pressed={subtree} onClick={() => setSubtree(!subtree)}>
            Include subfolders
          </button>
        )}
        {mode === 'files' && search.running && (
          <IconButton icon="pause" label="Cancel search" onClick={search.cancel} />
        )}
      </div>
      {mode === 'files' && listing.error && (
        <p className="inline-warning" role="alert">
          {listing.error}
        </p>
      )}
    </Dialog>
  );
}
