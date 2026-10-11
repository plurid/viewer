import { useCallback, useEffect, useState } from 'react';
import type { FileEntry } from '../../domain/contracts';

const emptyEntries: FileEntry[] = [];

export function useFolder(path: string) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loadedPath, setLoadedPath] = useState('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let live = true;
    setError('');
    void window.viewer
      .list(path)
      .then((listing) => {
        if (live) {
          setEntries(listing.entries);
          setLoadedPath(path);
        }
      })
      .catch((error) => {
        if (live) {
          setError(error.message);
          setLoadedPath(path);
          setEntries([]);
        }
      });
    return () => {
      live = false;
    };
  }, [path, revision]);
  useEffect(() => {
    const subscriber = crypto.randomUUID();
    let live = true;
    const remove = window.viewer.onEvent((event) => {
      if (event.type === 'folder-changed' && event.path === path) refresh();
      if (event.type === 'watch-error' && event.path === path)
        setError(`Folder watching is unavailable: ${event.message}`);
    });
    void window.viewer
      .watch(path, subscriber)
      .then(() => {
        if (!live) void window.viewer.unwatch(subscriber);
      })
      .catch((error) => {
        if (live) setError(error.message);
      });
    window.addEventListener('viewer:refresh', refresh);
    return () => {
      live = false;
      remove();
      window.removeEventListener('viewer:refresh', refresh);
      void window.viewer.unwatch(subscriber);
    };
  }, [path, refresh]);
  return {
    entries: loadedPath === path ? entries : emptyEntries,
    loading: loadedPath !== path,
    error,
    refresh,
  };
}
