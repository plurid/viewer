// Folder lenses as seen by this window: loaded per folder, edited optimistically, and saved in
// order by the desktop service. Lens edits share one Undo history with file operations.
import { useCallback, useSyncExternalStore } from 'react';
import {
  applyLensOps,
  diffLensOps,
  lensFolder,
  lensSubfolder,
  type LensApplied,
  type LensDocument,
  type LensFolder,
  type LensOp,
} from '../../domain/files/lenses';
import type { FolderPresentation } from '../../domain/preferences/folder-presentation';
import { report } from './core';

export interface LensView {
  data: LensFolder | null;
  loading: boolean;
  error: string;
}
interface Subscription {
  state: LensView;
  listeners: Set<() => void>;
  request?: Promise<void>;
  dirty: boolean;
  stop?: () => void;
  /** Edits waiting to be sent, and whether a save is under way, by lens file. */
  pending: Map<string, LensOp[]>;
  sending: Set<string>;
}
const folders = new Map<string, Subscription>();
const empty: LensView = { data: null, loading: true, error: '' };
function subscription(folder: string): Subscription {
  let value = folders.get(folder);
  if (!value) {
    value = {
      state: empty,
      listeners: new Set(),
      dirty: false,
      pending: new Map(),
      sending: new Set(),
    };
    folders.set(folder, value);
  }
  return value;
}
const notify = (value: Subscription) => value.listeners.forEach((listener) => listener());
export const lensDirectory = (folder: string) =>
  folder.replace(/\/$/, '') + '/' + lensFolder + '/' + lensSubfolder;

/** Unsaved edits stay visible on top of what the desktop service last reported. */
function withPending(value: Subscription, document: LensDocument): LensDocument {
  const pending = value.pending.get(document.file);
  return pending?.length
    ? { ...document, lens: applyLensOps(document.lens, pending).lens }
    : document;
}
function load(folder: string): void {
  const value = subscription(folder);
  if (value.request) {
    value.dirty = true;
    return;
  }
  value.request = window.viewer
    .lens({ kind: 'list', folder })
    .then((reply) => {
      const data = reply as LensFolder;
      value.state = {
        data: { ...data, lenses: data.lenses.map((document) => withPending(value, document)) },
        loading: false,
        error: '',
      };
    })
    .catch((error: Error) => {
      value.state = { data: value.state.data, loading: false, error: error.message };
    })
    .finally(() => {
      value.request = undefined;
      notify(value);
      if (value.dirty) {
        value.dirty = false;
        load(folder);
      }
    });
}
export function useLenses(folder: string): LensView {
  const subscribe = useCallback(
    (listener: () => void) => {
      const value = subscription(folder);
      value.listeners.add(listener);
      if (!value.stop) {
        const subscriber = crypto.randomUUID();
        let timer: ReturnType<typeof setTimeout> | undefined,
          watching = false,
          stopped = false;
        const refresh = (delay: number) => {
          clearTimeout(timer);
          timer = setTimeout(() => load(folder), delay);
        };
        const off = window.viewer.onEvent((event) => {
          if (event.type === 'lens-changed' && event.folder === folder) refresh(60);
          // The lens folder went away (its last lens trashed with it): end that watch, and leave
          // noticing a new one to the folder's own watch; nothing is created in order to watch.
          else if (event.type === 'watch-error' && event.path === lensDirectory(folder)) {
            if (watching) void window.viewer.unwatch(subscriber).catch(() => {});
            watching = false;
            refresh(300);
          } else if (
            event.type === 'folder-changed' &&
            (event.path === folder || event.path === lensDirectory(folder))
          )
            refresh(300);
        });
        // Edits made by other people arrive as file changes inside `.viewer/lenses`.
        const watch = () => {
          if (watching || stopped || !value.state.data?.lenses.some((lens) => !lens.local)) return;
          watching = true;
          void window.viewer.watch(lensDirectory(folder), subscriber).catch(() => {
            watching = false;
          });
        };
        value.listeners.add(watch);
        load(folder);
        value.stop = () => {
          stopped = true;
          clearTimeout(timer);
          off();
          value.listeners.delete(watch);
          if (watching) void window.viewer.unwatch(subscriber).catch(() => {});
          value.stop = undefined;
        };
      }
      return () => {
        value.listeners.delete(listener);
        if (value.listeners.size <= 1 && value.stop) {
          value.stop();
          if (!value.pending.size && !value.sending.size) folders.delete(folder);
        }
      };
    },
    [folder],
  );
  return useSyncExternalStore(subscribe, () => folders.get(folder)?.state ?? empty);
}
function lensSnapshot(folder: string): LensFolder | null {
  return folders.get(folder)?.state.data ?? null;
}
/** The lens grouping a folder, if it is grouped by one. */
export function activeLens(
  data: LensFolder | null,
  presentation: Pick<FolderPresentation, 'group' | 'lens'>,
): LensDocument | undefined {
  if (presentation.group !== 'lens' || !data?.lenses.length) return undefined;
  return data.lenses.find((document) => document.lens.id === presentation.lens) ?? data.lenses[0];
}
function replace(value: Subscription, document: LensDocument) {
  const data = value.state.data;
  if (!data) return;
  value.state = {
    ...value.state,
    data: {
      ...data,
      lenses: data.lenses.some((item) => item.file === document.file)
        ? data.lenses.map((item) => (item.file === document.file ? document : item))
        : [...data.lenses, document],
    },
  };
  notify(value);
}
function send(folder: string, file: string): void {
  const value = subscription(folder);
  const ops = value.pending.get(file);
  if (!ops?.length || value.sending.has(file)) return;
  value.pending.delete(file);
  value.sending.add(file);
  void window.viewer
    .lens({ kind: 'apply', folder, file, ops })
    .then((reply) => {
      const { document, dropped } = reply as LensApplied;
      replace(value, withPending(value, document));
      if (dropped.length) report(new Error(dropped.join(' ')));
    })
    .catch((error: unknown) => {
      report(error);
      load(folder);
    })
    .finally(() => {
      value.sending.delete(file);
      if (value.pending.get(file)?.length) send(folder, file);
      else if (!value.listeners.size && !value.sending.size) folders.delete(folder);
    });
}
let sendTimer: ReturnType<typeof setTimeout> | undefined;
const queued = new Set<string>();
function queue(folder: string, file: string, ops: readonly LensOp[]) {
  const value = subscription(folder);
  value.pending.set(file, [...(value.pending.get(file) ?? []), ...ops]);
  queued.add(JSON.stringify([folder, file]));
  clearTimeout(sendTimer);
  // A burst of edits, such as a drag across many items, saves once.
  sendTimer = setTimeout(() => {
    for (const key of queued) {
      const [target, document] = JSON.parse(key) as [string, string];
      send(target, document);
    }
    queued.clear();
  }, 120);
}

interface HistoryEntry {
  label: string;
  time: number;
  undo(): Promise<void> | void;
  redo?(): Promise<void> | void;
}
const undoStack: HistoryEntry[] = [];
const redoStack: HistoryEntry[] = [];
function remember(entry: Omit<HistoryEntry, 'time'>) {
  undoStack.push({ ...entry, time: Date.now() });
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
}
export function lastLensUndo(): HistoryEntry | undefined {
  return undoStack.at(-1);
}
export function lastLensRedo(): HistoryEntry | undefined {
  return redoStack.at(-1);
}
export async function undoLens(): Promise<void> {
  const entry = undoStack.pop();
  if (!entry) return;
  await entry.undo();
  if (entry.redo) {
    redoStack.push({ ...entry, time: Date.now() });
  }
}
export async function redoLens(): Promise<void> {
  const entry = redoStack.pop();
  if (!entry?.redo) return;
  await entry.redo();
  undoStack.push({ ...entry, time: Date.now() });
}

/** Applies edits immediately here and saves them in the background. */
function change(folder: string, file: string, ops: readonly LensOp[]): void {
  if (!ops.length) return;
  const value = folders.get(folder);
  const document = value?.state.data?.lenses.find((item) => item.file === file);
  if (value && document)
    replace(value, { ...document, lens: applyLensOps(document.lens, ops).lens });
  queue(folder, file, ops);
}
export function editLens(
  folder: string,
  file: string,
  ops: readonly LensOp[],
  label: string,
): void {
  const document = lensSnapshot(folder)?.lenses.find((item) => item.file === file);
  if (!document) {
    report(new Error('This lens is no longer available.'));
    return;
  }
  if (!document.writable) {
    report(new Error('This folder cannot be changed, so its lenses are read-only here.'));
    return;
  }
  const before = document.lens,
    after = applyLensOps(before, ops).lens;
  const undo = diffLensOps(after, before),
    redo = diffLensOps(before, after);
  if (!redo.length) return;
  change(folder, file, ops);
  remember({
    label,
    undo: () => change(folder, file, undo),
    redo: () => change(folder, file, redo),
  });
}
export async function createLens(
  folder: string,
  name: string,
  ops: readonly LensOp[] = [],
  label = 'New lens',
): Promise<LensDocument> {
  const document = (await window.viewer.lens({
    kind: 'create',
    folder,
    name,
    ops: [...ops],
  })) as LensDocument;
  const value = folders.get(folder);
  if (value?.state.data) replace(value, document);
  load(folder);
  remember({ label, undo: () => trashLens(folder, document.file) });
  return document;
}
/** Moves a lens file to the Trash; inside the folder this is an undoable file operation. */
export async function trashLens(folder: string, file: string): Promise<void> {
  const value = folders.get(folder);
  value?.pending.delete(file);
  await window.viewer.lens({ kind: 'trash', folder, file });
  if (value?.state.data)
    value.state = {
      ...value.state,
      data: {
        ...value.state.data,
        lenses: value.state.data.lenses.filter((item) => item.file !== file),
      },
    };
  if (value) notify(value);
}
export async function shareLens(folder: string, file: string): Promise<void> {
  await window.viewer.lens({ kind: 'share', folder, file });
  load(folder);
}
export function setCollapsedGroups(folder: string, lens: string, groups: string[]): void {
  const value = folders.get(folder);
  if (value?.state.data) {
    value.state = {
      ...value.state,
      data: { ...value.state.data, collapsed: { ...value.state.data.collapsed, [lens]: groups } },
    };
    notify(value);
  }
  void window.viewer.lens({ kind: 'collapse', lens, groups }).catch(report);
}
