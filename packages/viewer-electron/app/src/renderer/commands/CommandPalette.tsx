import { useEffect, useMemo, useState } from 'react';
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
import { ChoiceButton } from '../ui/ChoiceMenu';
import { useFolder } from '../explorer/useFolder';
import { useSearch } from '../explorer/useSearch';
import { useIndexedSearch } from '../explorer/useIndexedSearch';
import { useWorkspace } from '../workspace/context';
import type { FileEntry } from '../../domain/contracts';
import { calculate, paletteIntent, rankFrecent } from './smart-palette';

export function CommandPalette({
  mode,
  onMode,
  onClose,
}: {
  mode: 'commands' | 'files' | 'workspaces';
  onMode(mode: 'commands' | 'files' | 'workspaces'): void;
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
      title={
        mode === 'files' ? 'Find file' : mode === 'workspaces' ? 'Change workspace' : 'Commands'
      }
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
        <CommandFinder
          key={mode}
          context={context}
          active={active}
          directory={directory}
          onClose={onClose}
          workspaces={mode === 'workspaces'}
          onCommands={() => onMode('commands')}
        />
      )}
    </Dialog>
  );
}

function CommandFinder({
  context,
  active,
  directory,
  onClose,
  workspaces,
  onCommands,
}: {
  context: CommandContext;
  active: string;
  directory: string;
  onClose(): void;
  workspaces: boolean;
  onCommands(): void;
}) {
  const registry = useCommands();
  useCommandRevision();
  const recent = useViewer((state) => state.saved.ui.recentCommands);
  const [query, setQuery] = useState('');
  const smart = useSmartRows(workspaces ? '' : query, context, directory);
  const commands = registry.list({ paneID: active, scope: 'window', context });
  const rows = [
    ...smart,
    ...rankCommands(
      workspaces ? commands.filter((command) => command.id.startsWith('workspace:')) : commands,
      query,
      recent,
      workspaces ? 'menu' : 'palette',
    ),
  ];
  return (
    <>
      <CommandResults
        query={query}
        onQuery={setQuery}
        rows={rows}
        onClose={workspaces ? onCommands : onClose}
        label={workspaces ? 'Search workspaces' : 'Search commands'}
        placeholder={
          workspaces ? 'Type a workspace name…' : 'Search commands, workspaces and places…'
        }
        leading={
          workspaces ? (
            <IconButton icon="left" label="Back to commands" onClick={onCommands} />
          ) : undefined
        }
        recent={recent.filter((id) => rows.some((row) => row.id === id)).slice(0, 2)}
        onSelect={(command) => {
          // a smart row's source ends with the palette: it runs first, as a found file's does
          if (command.id.startsWith('smart:')) {
            void registry.run(command).catch(report);
            onClose();
            return;
          }
          onClose();
          requestAnimationFrame(() => {
            void registry.run(command).catch(report);
          });
        }}
      />
      <div className="palette-context">
        {workspaces ? (
          <span>Current workspace: {activeWorkspace().name}</span>
        ) : (
          <span title={directory}>
            {context.selection.length ? `${context.selection.length} selected · ` : ''}
            {directory}
          </span>
        )}
      </div>
    </>
  );
}

/**
 * THE SMART PALETTE'S ROWS (2026-10-23), above the commands: a typed path's folder contents, a
 * calculation, frecent folders for `z`, or a command with its argument (smart-palette.ts).
 */
function useSmartRows(
  query: string,
  context: CommandContext,
  directory: string,
): ResolvedCommand[] {
  const registry = useCommands();
  const workspace = useWorkspace();
  const home = getState().bootstrap.home;
  const intent = useMemo(() => paletteIntent(query, home, directory), [query, home, directory]);
  const [listing, setListing] = useState<{ directory: string; entries: FileEntry[] }>();
  const listed = intent?.kind === 'path' ? intent.directory : '';
  useEffect(() => {
    if (!listed) return;
    let live = true;
    const timer = setTimeout(() => {
      void window.viewer
        .list(listed)
        .then((result) => {
          if (live) setListing({ directory: listed, entries: result.entries });
        })
        .catch(() => {
          if (live) setListing({ directory: listed, entries: [] });
        });
    }, 80);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [listed]);
  const open = (path: string) => async () => {
    const entry = await window.viewer.stat(path);
    if (activeWorkspace().id !== context.workspaceID) return;
    await workspace.openPath(entry.path, {
      paneID: context.paneID,
      workspaceID: context.workspaceID,
    });
  };
  const sourceID = useMemo(() => `smart:${crypto.randomUUID()}`, []);
  const row = (
    id: string,
    definition: Omit<CommandDefinition, 'id' | 'when' | 'remember' | 'primary'>,
  ): CommandDefinition => ({
    ...definition,
    id: `smart:${id}`,
    primary: true,
    remember: false,
    when: () => true,
  });
  const definitions: CommandDefinition[] = (() => {
    if (!intent) return [];
    if (intent.kind === 'calc') {
      const value = calculate(intent.expression);
      if (value === undefined) return [];
      const text = Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12)));
      return [
        row('calc', {
          label: `= ${text}`,
          detail: 'Copy the result',
          group: 'Calculator',
          icon: 'copy',
          run: () => navigator.clipboard.writeText(text),
        }),
      ];
    }
    if (intent.kind === 'jump')
      return rankFrecent(getState().saved.visits ?? {}, intent.text, Date.now())
        .slice(0, 10)
        .map((path) =>
          row(`jump:${path}`, {
            label: path.split('/').pop() || path,
            detail: path,
            group: 'Frecent folders',
            icon: 'folder',
            run: open(path),
          }),
        );
    if (intent.kind === 'path') {
      const entries = listing?.directory === intent.directory ? listing.entries : [];
      const hidden = intent.partial.startsWith('.');
      return [
        ...(intent.partial
          ? []
          : [
              row(`path:${intent.directory}`, {
                label: intent.directory,
                detail: 'Open this folder',
                group: 'Go',
                icon: 'folder',
                run: open(intent.directory),
              }),
            ]),
        ...rankFiles(
          entries.filter((entry) => hidden || !entry.hidden),
          intent.partial,
          12,
        ).map((entry) =>
          row(`path:${entry.path}`, {
            label: entry.name,
            detail: entry.parent,
            group: 'Go',
            icon: entry.directory ? 'folder' : 'file',
            run: open(entry.path),
          }),
        ),
      ];
    }
    const name = intent.text;
    const selected = context.selection;
    if (intent.command === 'go-to')
      return [row('go', { label: `Go to ${name}`, group: 'Go', icon: 'folder', run: open(name) })];
    if (intent.command === 'rename')
      return selected.length === 1
        ? [
            row('rename', {
              label: `Rename “${selected[0]!.name}” to “${name}”`,
              group: 'Files',
              icon: 'rename',
              run: async () => {
                await window.viewer.operate({ kind: 'rename', name, sources: [selected[0]!.path] });
              },
            }),
          ]
        : [];
    if (!context.directory) return [];
    const kind = intent.command === 'new-folder' ? 'mkdir' : 'mkfile';
    return [
      row(intent.command, {
        label: `${kind === 'mkdir' ? 'New folder' : 'New file'} “${name}”`,
        detail: context.directory,
        group: 'Files',
        icon: kind === 'mkdir' ? 'folder' : 'file',
        run: async () => {
          await window.viewer.operate({ kind, name, sources: [], destination: context.directory });
        },
      }),
    ];
  })();
  useCommandSource(
    sourceID,
    {
      context: () => context,
      definitions: () => definitions,
      valid: (invocation) => invocation.workspaceID === activeWorkspace().id,
    },
    // the palette's context is a new object each render: republishing on it never settled
    [intent, listing],
  );
  return definitions.length ? registry.list({ sources: [sourceID] }) : [];
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
        <ChoiceButton
          label="Search scope"
          value={scope}
          choices={[
            { value: 'folder', label: 'This folder' },
            { value: 'subfolders', label: 'Subfolders' },
            { value: 'all', label: 'Indexed locations' },
          ]}
          onChoose={(value) => setScope(value as typeof scope)}
        />
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
