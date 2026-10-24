import { matchesQuery, topWords, withoutTopWords } from '../../domain/file-query';
import { useFileQuery } from '../explorer/useFileQuery';
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
import { LineFinder } from '../command-line/LineFinder';
import { PromptFinder } from '../command-line/PromptFinder';
import { lineHint } from '../command-line/hints';
import { quoteWord } from '../../domain/command-line/lex';
import type { LineHost } from '../command-line/host';
import {
  choicesPrefix,
  moreSettingsID,
  paletteRows,
  paletteSuggestions,
  settingRows,
} from './palette-sections';
import { palettePrefixes, type PaletteMode } from './palette-modes';

export function CommandPalette({
  mode,
  onMode,
  onClose,
  initialQuery = '',
  line,
}: {
  mode: PaletteMode;
  onMode(mode: PaletteMode): void;
  onClose(): void;
  /** Text the palette opens with (`:help` opens the command line at `help`). */
  initialQuery?: string;
  /** The command line: what a line runs against, and running one (App closes the palette first). */
  line?: { host: LineHost; run(text: string, model?: boolean): void };
}) {
  const registry = useCommands();
  // what was typed, carried into the mode it chose: `,wrap` searches the settings for "wrap"
  const [carried, setCarried] = useState(initialQuery);
  const change = (next: PaletteMode, query = '') => {
    setCarried(query);
    onMode(next);
  };
  useCommandRevision();
  const active = useViewer((state) => state.activePane);
  const context = registry.context(active)!;
  const directory =
    context.directory || (context.path ? parentPath(context.path) : getState().bootstrap.home);
  return (
    <Dialog
      title={
        mode === 'files'
          ? 'Find file'
          : mode === 'workspaces'
            ? 'Change workspace'
            : mode === 'settings'
              ? 'Settings'
              : mode === 'line'
                ? 'Command line'
                : mode === 'prompt'
                  ? 'Ask in words'
                  : 'Commands'
      }
      onClose={onClose}
      className="command-palette"
    >
      {mode === 'prompt' && line ? (
        <PromptFinder
          host={line.host}
          initialQuery={carried}
          onRun={(text) => line.run(text, true)}
          onEdit={(text) => change('line', text)}
          onBack={() => change('commands')}
          onChat={(text) => {
            const paths = context.selection.length
              ? context.selection.map((file) => file.path)
              : [directory];
            onClose();
            void line.host.workspace.newChat(paths, text).catch(report);
          }}
        />
      ) : mode === 'line' && line ? (
        <LineFinder
          host={line.host}
          initialQuery={carried}
          onRun={line.run}
          onBack={() => change('commands')}
        />
      ) : mode === 'files' ? (
        <FileFinder
          key={`${context.workspaceID}:${active}:${directory}`}
          context={context}
          directory={directory}
          onCommands={() => change('commands')}
          onClose={onClose}
        />
      ) : (
        <CommandFinder
          key={mode}
          context={context}
          active={active}
          directory={directory}
          onClose={onClose}
          mode={mode === 'line' || mode === 'prompt' ? 'commands' : mode}
          initialQuery={carried}
          onMode={change}
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
  mode,
  initialQuery,
  onMode,
}: {
  context: CommandContext;
  active: string;
  directory: string;
  onClose(): void;
  mode: Exclude<PaletteMode, 'files'>;
  initialQuery: string;
  onMode(mode: PaletteMode, query?: string): void;
}) {
  const registry = useCommands();
  useCommandRevision();
  const recent = useViewer((state) => state.saved.ui.recentCommands);
  const [query, setQuery] = useState(initialQuery);
  const workspaces = mode === 'workspaces';
  const settings = mode === 'settings';
  const nested = workspaces || settings;
  const onCommands = () => onMode('commands');
  const smart = useSmartRows(nested ? '' : query, context, directory);
  // the smart rows' own source shares the plane: listed once, above (2026-10-23)
  const commands = registry
    .list({ paneID: active, scope: 'window', context })
    .filter((command) => !command.id.startsWith('smart:'));
  // settings apart (palette-sections.ts): their own section, or `,` for them alone
  const view = workspaces
    ? {
        rows: rankCommands(
          commands.filter((command) => command.id.startsWith('workspace:')),
          query,
          recent,
          'menu',
        ),
        headings: undefined,
      }
    : settings
      ? settingRows(commands, query)
      : paletteRows(commands, query, recent);
  const rows = paletteSuggestions(view.rows, smart, query);
  return (
    <>
      <CommandResults
        query={query}
        onQuery={(text) => {
          if (mode === 'commands' && text.startsWith(palettePrefixes.settings))
            onMode('settings', text.slice(palettePrefixes.settings.length).trimStart());
          else if (mode === 'commands' && text.startsWith(palettePrefixes.line))
            onMode('line', text.slice(palettePrefixes.line.length));
          else if (mode === 'commands' && text.startsWith(palettePrefixes.prompt))
            onMode('prompt', text.slice(palettePrefixes.prompt.length).trimStart());
          else setQuery(text);
        }}
        rows={rows}
        headings={view.headings}
        hint={workspaces ? undefined : lineHint}
        onClose={nested ? onCommands : onClose}
        onEmptyBackspace={nested ? onCommands : undefined}
        label={workspaces ? 'Search workspaces' : settings ? 'Search settings' : 'Search commands'}
        placeholder={
          workspaces
            ? 'Type a workspace name…'
            : settings
              ? 'Search settings…'
              : 'Search commands, workspaces and places…'
        }
        empty={settings ? 'No matching settings' : undefined}
        leading={
          nested ? (
            <IconButton icon="left" label="Back to commands" onClick={onCommands} />
          ) : undefined
        }
        recent={
          settings ? [] : recent.filter((id) => rows.some((row) => row.id === id)).slice(0, 2)
        }
        onSelect={(command) => {
          if (command.id === moreSettingsID) {
            onMode('settings', query);
            return;
          }
          // a setting's choices, folded into one row: listed by its name and a colon
          if (command.id.startsWith(choicesPrefix)) {
            const named = `${command.setting!.name}: `;
            if (settings) setQuery(named);
            else onMode('settings', named);
            return;
          }
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
        ) : settings ? (
          <span>⌘, opens Settings</span>
        ) : (
          <>
            <span title={directory}>
              {context.selection.length ? `${context.selection.length} selected · ` : ''}
              {directory}
            </span>
            <span className="palette-hint">
              <kbd>{palettePrefixes.settings}</kbd> settings
            </span>
          </>
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
      return [
        row('go', {
          label: `Go to ${name}`,
          // the line it is, to learn: `:e ~/Downloads` (2026-10-23)
          detail: `:e ${quoteWord(name)}`,
          group: 'Go',
          icon: 'folder',
          run: open(name),
        }),
      ];
    if (intent.command === 'rename')
      return selected.length === 1
        ? [
            row('rename', {
              label: `Rename “${selected[0]!.name}” to “${name}”`,
              detail: `:mv ${quoteWord(name)}`,
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
        detail: `:${kind === 'mkdir' ? 'mkdir' : 'touch'} ${quoteWord(name)} · ${context.directory}`,
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
  // the file query language here too (2026-10-24): terms filter, the words rank the names
  const finderQuery = useFileQuery(query, directory);
  const matches = useMemo(() => {
    if (indexedMode) return indexed.result?.entries || [];
    if (subtree && query.trim()) return search.entries;
    const terms = withoutTopWords(finderQuery.query);
    return rankFiles(
      listing.entries.filter(
        (entry) =>
          (context.folder?.showHidden || !entry.hidden) &&
          (!terms.root || matchesQuery(terms, entry, finderQuery.facts)),
      ),
      terms.root ? topWords(finderQuery.query).join(' ') : query,
    );
  }, [
    listing.entries,
    search.entries,
    indexed.result,
    indexedMode,
    subtree,
    query,
    finderQuery,
    context.folder?.showHidden,
  ]);
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
