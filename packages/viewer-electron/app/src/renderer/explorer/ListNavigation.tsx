import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FileEntry } from '../../domain/contracts';
import { sortEntries } from '../../domain/files';
import { browseSession, useBrowseField } from '../workspace/sessions';
import { folderPresentation } from '../state/store';
import { useFolder } from './useFolder';
function Branch({
  path,
  receive,
}: {
  path: string;
  receive(path: string, entries: FileEntry[]): void;
}) {
  const listing = useFolder(path);
  useEffect(() => {
    if (!listing.loading) receive(path, listing.unavailable ? [] : listing.entries);
  }, [path, listing.entries, listing.loading, listing.unavailable, receive]);
  return null;
}
export function useListNavigation(id: string, path: string, roots: FileEntry[], active: boolean) {
  const [expanded, setExpanded] = useBrowseField(id, path, 'expanded');
  const session = browseSession(id, path);
  const [children, setChildren] = useState(session.listChildren);
  const receive = useMemo(
    () => (path: string, entries: FileEntry[]) =>
      setChildren((before) =>
        before.get(path) === entries
          ? before
          : (session.listChildren = new Map(before).set(path, entries)),
      ),
    [session],
  );
  useEffect(() => {
    setChildren(session.listChildren);
  }, [session]);
  const { entries, depths } = useMemo(() => {
    const depths = new Map<string, number>();
    const entries: FileEntry[] = [];
    const visit = (items: FileEntry[], depth: number) => {
      for (const entry of items) {
        entries.push(entry);
        depths.set(entry.path, depth);
        if (active && expanded.includes(entry.path) && depth < 30) {
          const presentation = folderPresentation(entry.path);
          visit(
            sortEntries(
              (children.get(entry.path) || []).filter(
                (file) => presentation.showHidden || !file.hidden,
              ),
              presentation.sort,
              presentation.descending,
              presentation.foldersFirst,
            ),
            depth + 1,
          );
        }
      }
    };
    visit(roots, 0);
    return { entries, depths };
  }, [roots, active, expanded, children]);
  // Refresh selected entries' metadata; selection itself adds what it needs, so the
  // cache does not grow with every visible row of a large folder.
  useEffect(() => {
    for (const entry of entries)
      if (session.cache.has(entry.path)) session.cache.set(entry.path, entry);
  }, [entries, session]);
  const toggle = useCallback(
    (entry: FileEntry, open = !expanded.includes(entry.path)) => {
      if (!entry.directory) return;
      setExpanded((items) =>
        open ? [...new Set([...items, entry.path])] : items.filter((path) => path !== entry.path),
      );
    },
    [expanded, setExpanded],
  );
  // Deleted children never remain expanded or selected after a refresh.
  useEffect(() => {
    if (!active) return;
    const visible = new Set(entries.map((entry) => entry.path));
    setExpanded((items) => {
      const next = items.filter((path) => visible.has(path));
      return next.length === items.length ? items : next;
    });
  }, [entries, active, setExpanded]);
  return {
    entries,
    depths,
    expanded,
    toggle,
    monitors: active
      ? expanded.map((path) => <Branch key={path} path={path} receive={receive} />)
      : null,
    horizontal(direction: 'left' | 'right', select: (entry: FileEntry) => void) {
      const cursor = entries.find((entry) => entry.path === session.cursor);
      if (!cursor) return;
      if (direction === 'right') {
        if (cursor.directory && !expanded.includes(cursor.path)) toggle(cursor, true);
        else {
          const child = entries.find((entry) => entry.parent === cursor.path);
          if (child) select(child);
        }
      } else if (cursor.directory && expanded.includes(cursor.path)) toggle(cursor, false);
      else {
        const parent = entries.find((entry) => entry.path === cursor.parent);
        if (parent) select(parent);
      }
    },
  };
}
