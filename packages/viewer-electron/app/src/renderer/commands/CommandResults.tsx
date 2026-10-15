import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../ui/Icon';
import type { ResolvedCommand } from './registry';

/** Search retains focus while arrows move the active descendant through results. */
export function CommandResults({
  query,
  onQuery,
  rows,
  onSelect,
  onClose,
  placeholder = 'Search actions…',
  label = 'Search actions',
  empty = 'No matching actions',
  recent = [],
  leading,
}: {
  query: string;
  onQuery(query: string): void;
  rows: readonly ResolvedCommand[];
  onSelect(command: ResolvedCommand): void;
  onClose(): void;
  placeholder?: string;
  label?: string;
  empty?: string;
  recent?: readonly string[];
  leading?: React.ReactNode;
}) {
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
      </div>
      <div
        className="command-results"
        ref={list}
        id={`${id}-list`}
        role="listbox"
        aria-label="Commands"
      >
        {!rows.length && (
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
            <button
              type="button"
              tabIndex={-1}
              id={`${id}-${rowIndex}`}
              role="option"
              aria-selected={index === rowIndex}
              className="command-result"
              onPointerMove={() => setActiveID(row.id)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(row)}
            >
              <Icon name={row.icon ?? 'file'} size={16} />
              <span className="command-result-text">
                <span>{row.label}</span>
                {row.detail && <small>{row.detail}</small>}
              </span>
              {row.shortcut && <kbd>{row.shortcut}</kbd>}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
