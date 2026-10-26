import { useEffect, useMemo, useRef, useState } from 'react';
import { LineError } from '../../domain/command-line/lex';
import { findVerb, parseCommandLine, verbName, verbs } from '../../domain/command-line/verbs';
import { settingByName, settingNames, settingText } from '../../domain/command-line/set';
import type { FileEntry } from '../../domain/contracts';
import { CommandResults } from '../commands/CommandResults';
import type { ResolvedCommand } from '../commands/registry';
import { settingNow } from '../commands/window-commands/settings';
import { getState, rememberLine, useViewer } from '../state/store';
import { IconButton } from '../ui/primitives';
import type { IconName } from '../ui/Icon';
import { lineCompletions, queryTerms, type Completion } from './complete';
import type { LineHost } from './host';
import { planLine, userCommands } from './run';
import { effectiveKeymap } from '../keys/session';
import { clearLineHistory } from '../commands/history';
import { bindingRows, keyGlyphs, type KeymapBinding } from '../../domain/preferences/keymap';

interface Row {
  id: string;
  label: string;
  detail?: string;
  icon: IconName;
  /** Choosing it puts this in the field; without it, choosing runs the line. */
  insert?: string;
}
/** `help [topic]` typed: what to list, or undefined for any other line. */
function helpTopic(query: string): string | undefined {
  try {
    const [step, ...more] = parseCommandLine(query);
    if (!step || more.length || findVerb(step.name)?.key !== 'help') return undefined;
    return step.words[0]?.text ?? '';
  } catch {
    return undefined;
  }
}
/** `:help` as rows: every verb with its usage, or one verb's or setting's whole help. */
function helpRows(topic: string): Row[] {
  const verb = topic ? findVerb(topic) : undefined;
  if (verb) {
    const name = verbName(verb);
    return [
      {
        id: 'help:usage',
        label: `${verb.names[0]}${verb.usage ? ' ' + verb.usage : ''}`,
        detail: verb.help,
        icon: 'command',
        insert: name + ' ',
      },
      {
        id: 'help:names',
        label: verb.names.join(', '),
        detail: 'Its names; vim’s [] marks what may be left out',
        icon: 'info',
        insert: name + ' ',
      },
      ...(verb.bang
        ? [
            {
              id: 'help:bang',
              label: `${name}!`,
              detail: verb.bang,
              icon: 'info' as const,
              insert: `${name}!`,
            },
          ]
        : []),
      ...Object.entries(verb.flags ?? {}).map(([flag, kind]) => ({
        id: `help:flag:${flag}`,
        label: `-${flag}${kind === 'value' ? ' {value}' : ''}`,
        detail: 'Flag',
        icon: 'info' as const,
        insert: `${name} -${flag} `,
      })),
    ];
  }
  if (topic === 'query') {
    // the file query language's terms, each with an example, to try in :filter
    return Object.entries(queryTerms).map(([term, example]) => ({
      id: `help:query:${term}`,
      label: term,
      detail: example,
      icon: 'search' as const,
      insert: `filter ${term}`,
    }));
  }
  if (topic === 'keys') {
    // every key of every table, as the line it runs
    const keymap = effectiveKeymap();
    const prefix = keymap.prefix ? keyGlyphs(keymap.prefix) + ' ' : '';
    const tables: [string, Record<string, KeymapBinding>][] = [
      [prefix, keymap.bindings],
      ['', keymap.root ?? {}],
      ...Object.entries(keymap.modes ?? {}).map(
        ([name, mode]): [string, Record<string, KeymapBinding>] => [`${name}: `, mode.bindings],
      ),
    ];
    return tables.flatMap(([lead, bindings], index) =>
      bindingRows(bindings).map((row) => ({
        id: `help:keys:${index}:${row.keys.join(' ')}`,
        label: lead + row.keys.map(keyGlyphs).join(' '),
        detail: row.commands.join(' | '),
        icon: 'command' as const,
        insert: row.commands.join(' | '),
      })),
    );
  }
  const setting = topic ? settingByName(topic) : undefined;
  if (setting || topic === 'set')
    return (setting ? [topic] : Object.keys(settingNames)).map((name) => {
      const definition = settingByName(name)!;
      return {
        id: `help:set:${name}`,
        label: settingText(definition, settingNow(definition.path)),
        detail: `${definition.label} · ${definition.path}`,
        icon: 'settings',
        insert: `set ${name}${definition.kind === 'boolean' ? '!' : '='}`,
      };
    });
  return [...verbs]
    .sort((a, b) => Number(!!a.tmux) - Number(!!b.tmux))
    .map((item) => {
      const name = verbName(item);
      return {
        id: `help:${item.key}`,
        // vim's notation teaches the short forms: q[uit], wa[ll]
        label: `${item.names[0]}${item.bang ? '[!]' : ''}${item.usage ? ' ' + item.usage : ''}`,
        detail: [item.help, item.names.length > 1 ? `also ${item.names.slice(1).join(', ')}` : '']
          .filter(Boolean)
          .join(' · '),
        icon: 'command',
        insert: name + (item.usage || item.flags ? ' ' : ''),
      };
    });
}
/**
 * The command line in the palette: a line typed after `:`, completed by Tab, its past
 * lines a ⌃P and ⌃N away, `help` listing what it can say. Enter runs it once it parses; an error
 * points at its column.
 */
export function LineFinder({
  host,
  initialQuery,
  onRun,
  onBack,
}: {
  host: LineHost;
  initialQuery: string;
  onRun(line: string): void;
  onBack(): void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [error, setError] = useState<{ message: string; at: number } | null>(null);
  const [historyAt, setHistoryAt] = useState(-1);
  const history = useViewer((state) => state.saved.lineHistory) ?? [];
  const workspaces = useViewer((state) => state.saved.workspaces);
  const [listing, setListing] = useState<{ directory: string; entries: FileEntry[] }>();
  const listed = useRef(new Map<string, FileEntry[]>());
  const context = host.context();
  const commands = useMemo(
    () => host.registry.list({ scope: 'window', paneID: context.paneID, context }),
    // a line's names come from the window's commands as the palette opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [host],
  );
  const home = getState().bootstrap.home;
  const { completions, directory } = useMemo(
    () =>
      lineCompletions(query, {
        commands,
        family: (prefix) =>
          commands
            .filter((command) => command.id.startsWith(prefix))
            .map((command) => /[“:]\s*(.+?)”?$/.exec(command.label)?.[1] ?? command.id),
        workspaces: workspaces.map((space) => space.name),
        value: settingNow,
        places: {
          home,
          folder: context.directory || home,
          current: context.path || context.directory,
        },
        listing,
        users: [...userCommands().keys()],
        modes: Object.keys(effectiveKeymap().modes ?? {}),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, commands, workspaces, listing],
  );
  useEffect(() => {
    if (!directory) return;
    const cached = listed.current.get(directory);
    if (cached) {
      setListing({ directory, entries: cached });
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void window.viewer
        .list(directory)
        .then((result) => result.entries)
        .catch(() => [] as FileEntry[])
        .then((entries) => {
          listed.current.set(directory, entries);
          if (live) setListing({ directory, entries });
        });
    }, 80);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [directory]);
  const topic = helpTopic(query);
  const preview = useMemo(() => {
    if (!query.trim() || topic !== undefined) return undefined;
    try {
      return planLine(query, host)
        .map((step) => step.label)
        .join(' → ');
    } catch (failure) {
      return failure instanceof LineError ? failure.message : undefined;
    }
  }, [query, topic, host]);
  const rows: Row[] =
    topic !== undefined
      ? helpRows(topic)
      : !query.trim()
        ? history.slice(0, 30).map((line, index) => ({
            id: `history:${index}`,
            label: line,
            detail: index ? undefined : 'Last line',
            icon: 'restore' as const,
            insert: line,
          }))
        : [
            { id: 'run', label: query, detail: preview, icon: 'right' },
            ...completions.map((item: Completion, index) => ({
              id: `complete:${index}`,
              label: item.label,
              detail: item.detail,
              icon: 'command' as const,
              insert: item.insert,
            })),
          ];
  const resolved: ResolvedCommand[] = rows.map((row) => ({
    id: row.id,
    label: row.label,
    detail: row.detail,
    icon: row.icon,
    group: 'Line',
    aliases: [],
    primary: false,
    source: '',
    context,
  }));
  const change = (text: string) => {
    setQuery(text);
    setError(null);
  };
  const run = () => {
    try {
      planLine(query, host);
    } catch (failure) {
      if (failure instanceof LineError) {
        setError({ message: failure.message, at: failure.at });
        return;
      }
      throw failure;
    }
    rememberLine(query);
    onRun(query);
  };
  return (
    <div className="line-finder">
      <CommandResults
        query={query}
        onQuery={(text) => {
          change(text);
          setHistoryAt(-1);
        }}
        rows={resolved}
        onClose={onBack}
        onEmptyBackspace={onBack}
        label="Command line"
        placeholder="help"
        empty="No lines yet: try help"
        leading={
          <>
            <IconButton icon="left" label="Back to commands" onClick={onBack} />
            <span className="line-prompt" aria-hidden="true">
              :
            </span>
          </>
        }
        onKey={(event) => {
          if (event.key === 'Tab' && !event.shiftKey) {
            const first = rows.find((row) => row.id.startsWith('complete:'));
            if (!first?.insert) return false;
            change(first.insert);
            return true;
          }
          if (event.ctrlKey && (event.key === 'p' || event.key === 'n')) {
            if (!history.length) return true;
            const next = Math.max(
              -1,
              Math.min(history.length - 1, historyAt + (event.key === 'p' ? 1 : -1)),
            );
            setHistoryAt(next);
            change(next < 0 ? '' : history[next]!);
            return true;
          }
          return false;
        }}
        onClearRecent={
          history.length
            ? () => {
                setHistoryAt(-1);
                clearLineHistory();
              }
            : undefined
        }
        clearRecentLabel="Clear recent command lines"
        onSelect={(chosen) => {
          const row = rows.find((item) => item.id === chosen.id);
          if (row?.insert !== undefined) change(row.insert);
          else run();
        }}
      />
      {error && (
        <div className="line-error" role="alert">
          <code>{query}</code>
          <code>
            {' '.repeat(Math.min(error.at, query.length))}^ {error.message}
          </code>
        </div>
      )}
      <div className="palette-context">
        <span>Tab completes · ⌃P ⌃N history · help lists commands</span>
      </div>
    </div>
  );
}
