import { useEffect, useMemo, useRef } from 'react';
import type { FileEntry } from '../../domain/contracts';
import type { BrowseSession } from '../workspace/sessions';

export type FileModifiers = { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean };
export type FileKey = Pick<
  KeyboardEvent,
  | 'key'
  | 'code'
  | 'shiftKey'
  | 'metaKey'
  | 'ctrlKey'
  | 'altKey'
  | 'target'
  | 'preventDefault'
  | 'stopPropagation'
>;
const keyboards = new Map<string, (event: FileKey) => void>();

/** File views and their chrome share input ownership, without subscribing the engine to selection. */
export function useFileKeyboard(id: string, handler: (event: FileKey) => void) {
  const current = useRef(handler);
  current.current = handler;
  useEffect(() => {
    const invoke = (event: FileKey) => current.current(event);
    keyboards.set(id, invoke);
    return () => {
      if (keyboards.get(id) === invoke) keyboards.delete(id);
    };
  }, [id]);
  return handler;
}
export function routeFileKeyboard(id: string, event: FileKey): void {
  keyboards.get(id)?.(event);
}
export function fileControlOwnsKey(event: FileKey): boolean {
  if (!(event.target instanceof Element)) return false;
  if (event.target.closest('[role="separator"]')) return true;
  if (event.target.closest('.preview-host')) {
    if (
      [
        'ArrowDown',
        'ArrowUp',
        'ArrowLeft',
        'ArrowRight',
        'Home',
        'End',
        'PageUp',
        'PageDown',
      ].includes(event.key)
    )
      event.stopPropagation();
    return true;
  }
  return (
    [' ', 'Enter'].includes(event.key) &&
    !!event.target.closest('button:not([data-file-path]), [role="button"]')
  );
}

/** The moving cursor is independent of the fixed range anchor and the ordered selected paths. */
export class FileSelection {
  private prefix = '';
  private typedAt = 0;
  constructor(
    private session: BrowseSession,
    private commit: (paths: string[]) => void,
  ) {}
  private apply(entries: readonly FileEntry[], preserve = false) {
    for (const entry of entries) this.session.cache.set(entry.path, entry);
    const paths = entries.map((entry) => entry.path);
    this.commit(preserve ? [...new Set([...this.session.selection, ...paths])] : paths);
  }
  click(entry: FileEntry, modifiers: FileModifiers, scope: readonly FileEntry[]) {
    const { session } = this;
    session.cursor = entry.path;
    if (modifiers.shiftKey) {
      let anchor = scope.findIndex((file) => file.path === session.anchor);
      const index = scope.findIndex((file) => file.path === entry.path);
      if (anchor < 0) {
        session.anchor = entry.path;
        anchor = index;
      }
      this.apply(
        scope.slice(Math.min(anchor, index), Math.max(anchor, index) + 1),
        modifiers.metaKey || modifiers.ctrlKey,
      );
    } else {
      session.anchor = entry.path;
      session.cache.set(entry.path, entry);
      this.commit(
        modifiers.metaKey || modifiers.ctrlKey
          ? session.selection.includes(entry.path)
            ? session.selection.filter((path) => path !== entry.path)
            : [...session.selection, entry.path]
          : [entry.path],
      );
    }
  }
  move(scope: readonly FileEntry[], key: string, shift: boolean, stride = 1, page = 10) {
    if (!scope.length) return;
    const { session } = this;
    const current = scope.findIndex((entry) => entry.path === session.cursor);
    const backwards = ['ArrowUp', 'ArrowLeft', 'PageUp'].includes(key);
    const step = ['PageUp', 'PageDown'].includes(key) ? page : stride;
    const index =
      key === 'Home'
        ? 0
        : key === 'End'
          ? scope.length - 1
          : current < 0
            ? backwards
              ? scope.length - 1
              : 0
            : Math.max(0, Math.min(scope.length - 1, current + (backwards ? -step : step)));
    if (shift && !scope.some((entry) => entry.path === session.anchor))
      session.anchor = scope[current >= 0 ? current : index].path;
    this.click(scope[index], { shiftKey: shift, metaKey: false, ctrlKey: false }, scope);
  }
  type(scope: readonly FileEntry[], text: string, now = performance.now()): FileEntry | undefined {
    const fold = (value: string) =>
      value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
    const character = fold(text);
    if (now - this.typedAt > 900) this.prefix = '';
    const cycle = this.prefix === character;
    this.prefix = cycle ? character : this.prefix + character;
    this.typedAt = now;
    const current = scope.findIndex((entry) => entry.path === this.session.cursor);
    const ordered =
      cycle || this.prefix.length === character.length
        ? [...scope.slice(current + 1), ...scope.slice(0, current + 1)]
        : [...scope];
    const entry = ordered.find((entry) => fold(entry.name).startsWith(this.prefix));
    if (entry) this.click(entry, { shiftKey: false, metaKey: false, ctrlKey: false }, scope);
    return entry;
  }
  target(entry: FileEntry) {
    this.session.cache.set(entry.path, entry);
    if (!this.session.selection.includes(entry.path))
      this.click(entry, { shiftKey: false, metaKey: false, ctrlKey: false }, [entry]);
  }
  all(scope: readonly FileEntry[]) {
    if (!scope.some((entry) => entry.path === this.session.cursor)) {
      this.session.cursor = scope[0]?.path || '';
      this.session.anchor = this.session.cursor;
    }
    this.apply(scope);
  }
  invert(scope: readonly FileEntry[]) {
    const selected = new Set(this.session.selection);
    const next = scope.filter((entry) => !selected.has(entry.path));
    this.session.cursor = next[0]?.path || '';
    this.session.anchor = this.session.cursor;
    this.apply(next);
  }
  clear() {
    this.session.cursor = '';
    this.session.anchor = '';
    this.commit([]);
  }
  removeBranch(path: string) {
    const belongs = (value: string) =>
      value === path ||
      value.startsWith(path.replace(/[\\/]$/, '') + (path.includes('\\') ? '\\' : '/'));
    for (const key of this.session.cache.keys()) if (belongs(key)) this.session.cache.delete(key);
    if (belongs(this.session.cursor)) this.session.cursor = '';
    if (belongs(this.session.anchor)) this.session.anchor = '';
    const next = this.session.selection.filter((value) => !belongs(value));
    if (next.length !== this.session.selection.length) this.commit(next);
  }
}
export function useFileSelection(session: BrowseSession, commit: (paths: string[]) => void) {
  return useMemo(() => new FileSelection(session, commit), [session, commit]);
}

export function blankFileSpace(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest(
      '.folder-content, .file-scroll, .gallery-strip, .gallery-preview, .search-explorer > .empty-state',
    ) &&
    !target.closest(
      '[data-file-path], button, input, select, textarea, a, [role=separator], .preview-host',
    )
  );
}
