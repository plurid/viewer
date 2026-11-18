import { useRef } from 'react';
import type { KeyboardEvent } from 'react';

/** How long typed letters keep adding to one type-ahead search, as Finder's lists do. */
const typeAheadPause = 1000;

/** The index whose label starts with `typed`, looking from `from` on and wrapping; -1 for none. */
export function typeAheadIndex(labels: readonly string[], typed: string, from: number): number {
  const wanted = typed.toLocaleLowerCase();
  for (let step = 0; step < labels.length; step++) {
    const index = (Math.max(0, from) + step) % labels.length;
    if (labels[index]!.toLocaleLowerCase().startsWith(wanted)) return index;
  }
  return -1;
}

/**
 * FINDER KEYS for a list in a dialog or a panel: ↑ ↓ Home End move the selection, letters jump to
 * the next row whose name starts with them, Return or ⌘↓ opens the selected row, ⌘↑ goes to the
 * parent where there is one, and Esc does what the list's owner gives it. The handler returns
 * whether it took the key, so the list's owner can let the rest through; a double-click on a row
 * opens it through `open` too (see `rowOpen`).
 */
export function useListKeys({
  labels,
  active,
  select,
  open,
  parent,
  escape,
  typeAhead = true,
}: {
  /** Each row's name, in list order: what type-ahead matches. */
  labels: readonly string[];
  /** The selected row, or -1. */
  active: number;
  select(index: number): void;
  open?(index: number): void;
  parent?(): void;
  escape?(): void;
  /** Off where the keys go to a search field above the list: letters type there. */
  typeAhead?: boolean;
}) {
  const typed = useRef({ text: '', at: 0 });
  const keyDown = (event: KeyboardEvent<HTMLElement>): boolean => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey) return false;
    const last = labels.length - 1;
    const take = (index: number) => {
      event.preventDefault();
      if (last >= 0) select(Math.min(last, Math.max(0, index)));
      return true;
    };
    if (event.metaKey) {
      if (event.key === 'ArrowDown' && open && active >= 0) {
        event.preventDefault();
        open(active);
        return true;
      }
      if (event.key === 'ArrowUp' && parent) {
        event.preventDefault();
        parent();
        return true;
      }
      return false;
    }
    switch (event.key) {
      case 'ArrowDown':
        return take(active < 0 ? 0 : active + 1);
      case 'ArrowUp':
        return take(active < 0 ? last : active - 1);
      case 'Home':
        return take(0);
      case 'End':
        return take(last);
      case 'Enter':
        if (!open || active < 0) return false;
        event.preventDefault();
        open(active);
        return true;
      case 'Escape':
        if (!escape) return false;
        event.preventDefault();
        escape();
        return true;
    }
    if (!typeAhead || event.key.length !== 1 || event.key === ' ' || !labels.length) return false;
    const now = event.timeStamp || Date.now();
    const text =
      now - typed.current.at < typeAheadPause ? typed.current.text + event.key : event.key;
    typed.current = { text, at: now };
    // a first letter looks past the selected row, as pressing it again cycles; more letters refine
    const index = typeAheadIndex(labels, text, text.length === 1 ? active + 1 : active);
    if (index < 0) return false;
    return take(index);
  };
  return keyDown;
}

/** A row's double-click opens it, as Return does, without a second selection change. */
export function rowOpen(index: number, open?: (index: number) => void) {
  return open ? () => open(index) : undefined;
}
