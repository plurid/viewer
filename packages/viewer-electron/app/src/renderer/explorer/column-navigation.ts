import { useCallback, useEffect, useMemo } from 'react';
import type { FileEntry } from '../../domain/contracts';
import { browsable } from '../../domain/files';
import { browseSession, useBrowseField } from '../workspace/sessions';
import type { FileModifiers, FileSelection } from './selection';

const plain = { shiftKey: false, metaKey: false, ctrlKey: false };
/** The active column owns selection, traversal and operation destinations together. */
export function useColumnNavigation(
  id: string,
  path: string,
  entries: FileEntry[],
  ready: boolean,
  selecting: FileSelection,
) {
  const session = browseSession(id, path);
  const [trail, setTrail] = useBrowseField(id, path, 'columnTrail');
  const [, setDirectory] = useBrowseField(id, path, 'columnDirectory');
  // Fresh per plane and folder: the keys reset these mutable holders on navigation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scopes = useMemo(() => new Map<string, FileEntry[]>(), [id, path]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pending = useMemo(() => ({ current: undefined as string | undefined }), [id, path]);
  const reveal = useCallback(
    (entry: FileEntry) => {
      const depth = entry.parent === path ? 0 : session.columnTrail.indexOf(entry.parent) + 1;
      if (depth < 0 || (entry.parent !== path && !depth)) return;
      setTrail((value) => {
        // an application shows its preview, not a column of its bundle, as in Finder
        const next = [...value.slice(0, depth), ...(browsable(entry) ? [entry.path] : [])];
        return next.length === value.length && next.every((part, index) => value[index] === part)
          ? value
          : next;
      });
      session.columnScope = entry.parent;
      setDirectory(browsable(entry) ? entry.path : entry.parent);
    },
    [path, session, setTrail, setDirectory],
  );
  const choose = useCallback(
    (entry: FileEntry, modifiers: FileModifiers, scope: FileEntry[]) => {
      selecting.click(entry, modifiers, scope);
      pending.current = undefined;
      reveal(entry);
    },
    [selecting, reveal, pending],
  );
  const register = useCallback(
    (directory: string, scope: FileEntry[]) => {
      const depth = directory === path ? 0 : session.columnTrail.indexOf(directory) + 1;
      if (directory !== path && !depth) return;
      scopes.set(directory, scope);
      const child = session.columnTrail[depth];
      if (child && !scope.some((entry) => browsable(entry) && entry.path === child)) {
        selecting.removeBranch(child);
        setTrail((value) => value.slice(0, depth));
        if (
          !scopes.has(session.columnScope) ||
          session.columnScope === child ||
          session.columnScope.startsWith(child + '/')
        )
          session.columnScope = directory;
        setDirectory(directory);
        pending.current = undefined;
      }
      for (const selected of session.selection) {
        const cached = session.cache.get(selected);
        if (cached?.parent === directory && !scope.some((entry) => entry.path === selected))
          selecting.removeBranch(selected);
      }
      if (pending.current === directory) {
        pending.current = undefined;
        session.columnScope = directory;
        setDirectory(directory);
        if (scope[0]) choose(scope[0], plain, scope);
      }
    },
    [path, session, selecting, setTrail, setDirectory, choose, scopes, pending],
  );
  useEffect(() => {
    if (ready) register(path, entries);
  }, [path, entries, ready, register]);
  const scope = () =>
    scopes.get(session.columnScope) || (session.columnScope === path ? entries : []);
  return {
    trail,
    register,
    unregister: useCallback(
      (directory: string) => {
        scopes.delete(directory);
      },
      [scopes],
    ),
    reveal,
    choose,
    directory: () => session.columnDirectory,
    scope,
    activate(directory: string) {
      session.columnScope = directory;
      setDirectory(directory);
    },
    move(key: string, shift: boolean) {
      const entries = scope();
      selecting.move(entries, key, shift);
      const entry = entries.find((item) => item.path === session.cursor);
      if (entry) reveal(entry);
    },
    right() {
      const entry = scope().find((item) => item.path === session.cursor);
      if (!entry || !browsable(entry)) return;
      reveal(entry);
      const children = scopes.get(entry.path);
      if (children) {
        session.columnScope = entry.path;
        if (children[0]) choose(children[0], plain, children);
      } else pending.current = entry.path;
    },
    left(): boolean {
      const current = scope().find((item) => item.path === session.cursor);
      const directory = current?.parent || session.columnScope;
      const parent =
        directory === path
          ? undefined
          : [path, ...session.columnTrail].find((parent) =>
              scopes.get(parent)?.some((entry) => entry.path === directory),
            );
      const entries = parent ? scopes.get(parent) : undefined;
      const entry = entries?.find((entry) => entry.path === directory);
      if (!entry || !entries) return false;
      choose(entry, plain, entries);
      return true;
    },
  };
}
export type ColumnNavigation = ReturnType<typeof useColumnNavigation>;
