import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../ui/Icon';
import { PathLabel } from '../ui/PathLabel';
import { FileName } from '../ui/FileName';
import type { DiscoverableCommand, ResolvedCommand } from './registry';

interface ResultOrder {
  query: string;
  label: string;
  ids: readonly string[];
}

type ResultSectionKind = 'open-workspace' | 'defined-workspace' | 'summary' | 'ordinary';

const absolutePath = /^(?:\/|[A-Za-z]:[\\/]|\\\\|viewer-sftp:)/i;

/** A file or folder row's text that is a path, as a typed path's row and a found file's folder. */
function isPath(row: ResolvedCommand, text: string | undefined): text is string {
  return (row.icon === 'folder' || row.icon === 'file') && !!text && absolutePath.test(text);
}
/** A found file's or folder's row: its label is the item's own name. */
const nameGroups = new Set(['Files', 'Frequent folders', 'Go']);
function isName(row: ResolvedCommand): boolean {
  return (row.icon === 'folder' || row.icon === 'file') && nameGroups.has(row.group);
}

/** Live results retain pointer stability within sections while respecting their current priority. */
function resultSections(
  incoming: readonly ResolvedCommand[],
  retained: readonly string[],
  headings: ReadonlyMap<string, string> | undefined,
  rankedWorkspaces: boolean,
): { ids: string[]; headings: ReadonlyMap<string, string> } {
  const sections = new Map<string, number>();
  const names = new Map<number, string>();
  let section = 0;
  let previous: ResultSectionKind | undefined;
  for (const row of incoming) {
    const kind: ResultSectionKind = row.id.startsWith('workspace:')
      ? 'open-workspace'
      : row.id.startsWith('defined:')
        ? 'defined-workspace'
        : row.id.startsWith('palette:more-')
          ? 'summary'
          : 'ordinary';
    const heading = headings?.get(row.id);
    if (
      heading !== undefined ||
      kind !== previous ||
      (rankedWorkspaces && (kind === 'open-workspace' || kind === 'defined-workspace'))
    )
      section++;
    sections.set(row.id, section);
    if (heading !== undefined) names.set(section, heading);
    previous = kind;
  }
  const ids = retained.toSorted((a, b) => sections.get(a)! - sections.get(b)!);
  const shown = new Map<string, string>();
  const seen = new Set<number>();
  for (const id of ids) {
    const section = sections.get(id)!;
    if (seen.has(section)) continue;
    seen.add(section);
    const name = names.get(section);
    if (name !== undefined) shown.set(id, name);
  }
  return { ids, headings: shown };
}

/** Search retains focus while arrows move the active descendant through results. */
export function CommandResults({
  query,
  onQuery,
  rows: incoming,
  unavailable = [],
  onSelect,
  onClose,
  placeholder = 'Search commands…',
  label = 'Search commands',
  empty = 'No matching commands',
  listLabel = 'Commands',
  recent = [],
  headings,
  leading,
  trailing,
  onEmptyBackspace,
  onKey,
  hint,
  onClearRecent,
  clearRecentLabel = 'Clear recent',
  footer,
}: {
  query: string;
  onQuery(query: string): void;
  rows: readonly ResolvedCommand[];
  /** Commands the query names that cannot run here: shown greyed out with why, never chosen. */
  unavailable?: readonly DiscoverableCommand[];
  onSelect(command: ResolvedCommand): void;
  onClose(): void;
  placeholder?: string;
  label?: string;
  empty?: string;
  /** The results' name: “Commands”, or what this mode lists, as “Files”. */
  listLabel?: string;
  recent?: readonly string[];
  /** Section headings, by the id of the row each comes before. */
  headings?: ReadonlyMap<string, string>;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  /** Backspace with nothing typed: out of a palette's mode. */
  onEmptyBackspace?(): void;
  /** A key the field handles itself first (the command line's Tab and history); true when it did. */
  onKey?(event: React.KeyboardEvent): boolean;
  /** The line a row is, shown beside it: `:q`, `:set grid!`. */
  hint?(row: ResolvedCommand): string | undefined;
  /** Clear the mode's existing history without changing its query or selected scope. */
  onClearRecent?(): void;
  clearRecentLabel?: string;
  footer?: string;
}) {
  const [order, setOrder] = useState<ResultOrder>(() => ({ query, label, ids: [] }));
  const current = new Map(incoming.map((row) => [row.id, row]));
  const retained =
    order.query === query && order.label === label ? order.ids.filter((id) => current.has(id)) : [];
  const seen = new Set(retained);
  const sections = resultSections(
    incoming,
    [...retained, ...[...current.keys()].filter((id) => !seen.has(id))],
    headings,
    !!query.trim(),
  );
  const ids = sections.ids;
  // Late completions must not move a row under the person's pointer or Return key.
  if (
    order.query !== query ||
    order.label !== label ||
    order.ids.length !== ids.length ||
    order.ids.some((id, index) => id !== ids[index])
  )
    setOrder({ query, label, ids });
  const rows = ids.map((id) => current.get(id)!);
  const [activeID, setActiveID] = useState('');
  const [keyboardScroll, setKeyboardScroll] = useState(0);
  const previousQuery = useRef(query);
  const index = Math.max(
    0,
    rows.findIndex((row) => row.id === activeID),
  );
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, [label]);
  useEffect(() => {
    if (previousQuery.current !== query) {
      previousQuery.current = query;
      if (list.current) list.current.scrollTop = 0;
    } else if (keyboardScroll) {
      list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    }
  }, [keyboardScroll, query]);
  return (
    <div
      className="command-search"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (
          event.key !== 'Escape' &&
          event.target instanceof Element &&
          event.target.closest('.command-search-field button')
        )
          return;
        if (onKey?.(event)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && rows.length) {
          event.preventDefault();
          event.stopPropagation();
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? rows.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
          const target = rows[next];
          if (target) setActiveID(target.id);
          setKeyboardScroll((value) => value + 1);
        } else if (event.key === 'Backspace' && !query && onEmptyBackspace) {
          event.preventDefault();
          onEmptyBackspace();
        } else if (event.key === 'Enter' && rows[index]) {
          event.preventDefault();
          event.stopPropagation();
          onSelect(rows[index]);
        }
      }}
    >
      <div className="command-search-field">
        {leading}
        <Icon name="search" size={16} />
        <input
          ref={input}
          data-autofocus
          aria-label={label}
          placeholder={placeholder}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-activedescendant={rows[index] ? `${id}-${index}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            onQuery(event.target.value);
            setActiveID('');
          }}
        />
        {onClearRecent && (
          <button
            type="button"
            className="command-clear-recent"
            aria-label={clearRecentLabel}
            title={clearRecentLabel}
            onClick={() => {
              onClearRecent();
              input.current?.focus({ preventScroll: true });
            }}
          >
            Clear Recent
          </button>
        )}
        {trailing}
      </div>
      <div
        className="command-results"
        ref={list}
        id={`${id}-list`}
        role="listbox"
        aria-label={listLabel}
      >
        {!rows.length && !unavailable.length && (
          <p className="command-empty" role="status">
            {empty}
          </p>
        )}
        {rows.map((row, rowIndex) => (
          <div key={row.id}>
            {!query && rowIndex === 0 && recent.includes(row.id) && (
              <div className="command-group">Recent</div>
            )}
            {!query &&
              rowIndex > 0 &&
              recent.includes(rows[rowIndex - 1]?.id ?? '') &&
              !recent.includes(row.id) && <div className="command-divider" />}
            {sections.headings.get(row.id) && (
              <div className="command-group">{sections.headings.get(row.id)}</div>
            )}
            <button
              type="button"
              tabIndex={-1}
              id={`${id}-${rowIndex}`}
              role="option"
              aria-selected={index === rowIndex}
              className={
                (row.setting ? 'command-result is-setting' : 'command-result') +
                (row.muted ? ' is-muted' : '')
              }
              onPointerMove={() => setActiveID(row.id)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(row)}
            >
              {/* a setting's switch shows whether it is on: the icon is the setting's */}
              <Icon
                name={typeof row.setting?.value === 'boolean' ? 'settings' : (row.icon ?? 'file')}
                size={16}
              />
              <span className="command-result-text">
                {isPath(row, row.label) ? (
                  <PathLabel path={row.label} />
                ) : isName(row) ? (
                  <FileName name={row.label} />
                ) : (
                  <span>{row.label}</span>
                )}
                {row.detail &&
                  (isPath(row, row.detail) ? (
                    <small>
                      <PathLabel path={row.detail} />
                    </small>
                  ) : (
                    <small>{row.detail}</small>
                  ))}
              </span>
              {row.badge && <small className="workspace-found-badge">{row.badge}</small>}
              {typeof row.setting?.value === 'boolean' ? (
                <span
                  className="command-switch"
                  data-on={String(row.setting.value)}
                  role="img"
                  aria-label={row.setting.value ? 'On' : 'Off'}
                />
              ) : (
                row.setting?.value && <span className="command-value">{row.setting.value}</span>
              )}
              {hint?.(row) && <code className="command-line-hint">:{hint(row)}</code>}
              {row.shortcut && <kbd>{row.shortcut}</kbd>}
            </button>
          </div>
        ))}
        {footer && (
          <p className="command-empty" role="status">
            {footer}
          </p>
        )}
        {unavailable.length > 0 && (
          <>
            <div className="command-group">Not available here</div>
            {/* out of the arrows' and Return's reach: no key or click runs one */}
            {unavailable.map((row) => (
              <div
                key={row.id}
                role="option"
                aria-disabled="true"
                aria-selected="false"
                className="command-result is-unavailable"
              >
                <Icon name={row.icon ?? 'file'} size={16} />
                <span className="command-result-text">
                  <span>{row.label}</span>
                  <small>{row.reason}</small>
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
