import { useCallback, useSyncExternalStore } from 'react';
import type { FileEntry } from '../../domain/contracts';
interface Dataset {
  entries: FileEntry[];
  loading: boolean;
  error: string;
  errorCode?: string;
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
}
const datasets = new Map<string, Subscription>();
function dataset(path: string): Subscription {
  let value = datasets.get(path);
  if (!value) {
    value = {
      state: { entries: [], loading: true, error: '' },
      listeners: new Set(),
      dirty: false,
    };
    datasets.set(path, value);
  }
  return value;
}
function notify(value: Subscription) {
  value.listeners.forEach((listener) => listener());
}
function load(path: string): void {
  const value = dataset(path);
  if (value.request) {
    value.dirty = true;
    return;
  }
  value.request = window.viewer
    .list(path)
    .then((listing) => {
      value.state = { entries: listing.entries, loading: false, error: '' };
    })
    .catch((error) => {
      value.state = {
        entries: [],
        loading: false,
        error: String(error.message || error),
        errorCode: error.code,
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
              if (stopped) void window.viewer.unwatch(subscriber);
            })
            .catch((error) => {
              watchFailed = true;
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
            value.state = {
              ...value.state,
              error: `Folder watching is unavailable: ${event.message}`,
              errorCode: event.code ?? value.state.errorCode,
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
        window.addEventListener('viewer:refresh', refresh);
        value.stop = () => {
          stopped = true;
          value.refresh = undefined;
          off();
          clearTimeout(timer);
          window.removeEventListener('viewer:refresh', refresh);
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
    const value = dataset(path);
    if (value.refresh) value.refresh();
    else load(path);
  }, [path]);
  return { ...state, refresh };
}
