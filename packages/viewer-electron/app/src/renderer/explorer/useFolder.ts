import { useCallback, useSyncExternalStore } from 'react';
import type { FileEntry } from '../../domain/contracts';
import { needsFolderAccess } from '../../domain/files/access';
import { refreshConcerns } from '../state/refresh';
import { onWindowEvent } from '../app/window-events';
interface Dataset {
  entries: FileEntry[];
  loading: boolean;
  /** What went wrong, for a message: the listing or the watch. */
  error: string;
  errorCode?: string;
  /** No listing to show: the folder could not be read, is gone or needs access. */
  unavailable: boolean;
}
interface Subscription {
  state: Dataset;
  listeners: Set<() => void>;
  request?: Promise<void>;
  dirty: boolean;
  stop?: () => void;
  refresh?: () => void;
  /** This folder's own identity, to tell an ancestor's unrelated change from a move. */
  identity?: string;
  /** A failed watch, until the watch starts again: a listing that loads after it keeps it said. */
  watchError?: { message: string; code?: string };
}
const datasets = new Map<string, Subscription>();
function dataset(path: string): Subscription {
  let value = datasets.get(path);
  if (!value) {
    value = {
      state: { entries: [], loading: true, error: '', unavailable: false },
      listeners: new Set(),
      dirty: false,
    };
    datasets.set(path, value);
  }
  return value;
}
/** A folder's entries as last listed, if they were: nothing is read for the asking. */
export function listedEntries(path: string): readonly FileEntry[] | undefined {
  const state = datasets.get(path)?.state;
  return state && !state.loading && !state.unavailable ? state.entries : undefined;
}
/** A folder's entries while a view shows it, so that its watch keeps them current; nothing is read
 * for the asking. A listing kept from before may be out of date. */
export function shownEntries(path: string): readonly FileEntry[] | undefined {
  const value = datasets.get(path);
  return value?.listeners.size ? listedEntries(path) : undefined;
}
function notify(value: Subscription) {
  value.listeners.forEach((listener) => listener());
}
const gone = (code?: string) => ['ENOENT', 'ENOTDIR', 'ENODEV', 'ENXIO'].includes(code ?? '');
function load(path: string): void {
  const value = dataset(path);
  if (value.request) {
    value.dirty = true;
    return;
  }
  value.request = window.viewer
    .list(path)
    .then((listing) => {
      value.state = {
        entries: listing.entries,
        loading: false,
        error: value.watchError?.message ?? '',
        errorCode: value.watchError?.code,
        unavailable: false,
      };
    })
    .catch((error) => {
      // A reload that fails keeps the listing it had, under its error, unless the folder is gone
      // or needs access again. It emptied the view, and a passing failure (a network volume's
      // timeout) left it empty until the next change in the folder.
      const listed = !value.state.loading && !value.state.unavailable;
      const keep = listed && !gone(error.code) && !needsFolderAccess(error.code);
      value.state = {
        entries: keep ? value.state.entries : [],
        loading: false,
        error: String(error.message || error),
        errorCode: error.code,
        unavailable: !keep,
      };
    })
    .finally(() => {
      value.request = undefined;
      notify(value);
      if (value.dirty) {
        value.dirty = false;
        load(path);
      }
    });
}
export function refreshFolder(path: string): void {
  const value = dataset(path);
  if (value.refresh) value.refresh();
  else load(path);
}
export function useFolder(path: string) {
  const subscribe = useCallback(
    (listener: () => void) => {
      const value = dataset(path);
      value.listeners.add(listener);
      if (!value.stop) {
        const subscriber = crypto.randomUUID();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let watchFailed = false;
        let stopped = false;
        let watchRequest: Promise<void> | undefined;
        const startWatch = (): Promise<void> => {
          if (stopped || watchRequest) return watchRequest ?? Promise.resolve();
          watchFailed = false;
          return (watchRequest = window.viewer
            .watch(path, subscriber)
            .then(() => {
              value.watchError = undefined;
              if (stopped) void window.viewer.unwatch(subscriber);
            })
            .catch((error) => {
              watchFailed = true;
              value.watchError = { message: String(error.message), code: error.code };
              if (!stopped) {
                value.state = {
                  ...value.state,
                  error: String(error.message),
                  errorCode: error.code,
                };
                notify(value);
              }
            })
            .finally(() => {
              watchRequest = undefined;
            }));
        };
        const refresh = () => {
          if (watchFailed) void startWatch();
          clearTimeout(timer);
          timer = setTimeout(() => load(path), 80);
        };
        // An ancestor's watch fires for any change in it (a .DS_Store or shell history
        // write in Home). Re-list only when this folder itself moved or was replaced.
        const ancestorChanged = () =>
          void window.viewer.stat(path).then(
            (entry) => {
              if (stopped) return;
              if (value.identity !== undefined && entry.identity !== value.identity) refresh();
              value.identity = entry.identity;
            },
            () => {
              if (!stopped) refresh();
            },
          );
        const off = window.viewer.onEvent((event) => {
          if (event.type === 'folder-changed') {
            if (event.path === path) refresh();
            else if (path.startsWith(event.path.replace(/\/$/, '') + '/')) ancestorChanged();
          }
          if (event.type === 'watch-error' && event.path === path) {
            watchFailed = true;
            value.watchError = {
              message: `Folder watching is unavailable: ${event.message}`,
              code: event.code ?? value.state.errorCode,
            };
            value.state = {
              ...value.state,
              error: value.watchError.message,
              errorCode: value.watchError.code,
            };
            notify(value);
          }
        });
        void startWatch();
        void window.viewer.stat(path).then(
          (entry) => {
            value.identity ??= entry.identity;
          },
          () => {},
        );
        value.refresh = refresh;
        const stopRefresh = onWindowEvent('viewer:refresh', (request) => {
          if (refreshConcerns(request, path)) refresh();
        });
        value.stop = () => {
          stopped = true;
          value.refresh = undefined;
          off();
          clearTimeout(timer);
          stopRefresh();
          void window.viewer.unwatch(subscriber);
        };
        load(path);
      }
      return () => {
        value.listeners.delete(listener);
        if (!value.listeners.size) {
          value.stop?.();
          value.stop = undefined;
        }
        if (datasets.size > 80)
          for (const [key, item] of datasets) {
            if (!item.listeners.size && !item.request && key !== path) datasets.delete(key);
            if (datasets.size <= 80) break;
          }
      };
    },
    [path],
  );
  const state = useSyncExternalStore(subscribe, () => dataset(path).state);
  const refresh = useCallback(() => {
    refreshFolder(path);
  }, [path]);
  return { ...state, refresh };
}
