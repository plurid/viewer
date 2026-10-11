/** Test-only bridge. This entry is never imported or included in production. */
import type { ApiMethod, DesktopEvent, ViewerAPI } from '../src/domain/contracts';
const listeners = new Set<(event: DesktopEvent) => void>();
const events = new EventSource('/__test/events');
events.onmessage = (event) => {
  const value = JSON.parse(event.data) as DesktopEvent;
  for (const listener of listeners) listener(value);
};
async function invoke<T>(method: ApiMethod, ...args: unknown[]): Promise<T> {
  // JSON represents undefined array members as null; omit optional trailing arguments.
  while (args.length && args.at(-1) === undefined) args.pop();
  const response = await fetch('/__test/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args }),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
const api: ViewerAPI = {
  bootstrap: () => invoke('bootstrap'),
  list: (path) => invoke('list', path),
  stat: (path) => invoke('stat', path),
  chooseFolder: () => invoke('chooseFolder'),
  reveal: (path) => invoke('reveal', path),
  openExternal: (path) => invoke('openExternal', path),
  watch: (path, subscriber) => invoke('watch', path, subscriber),
  unwatch: (subscriber) => invoke('unwatch', subscriber),
  search: (request) => invoke('search', request),
  cancelSearch: (id) => invoke('cancelSearch', id),
  operate: (request) => invoke('operate', request),
  jobs: () => invoke('jobs'),
  cancelJob: (id) => invoke('cancelJob', id),
  resolveCollision: (id, decision, all) => invoke('resolveCollision', id, decision, all),
  undo: (id) => invoke('undo', id),
  resource: (path) => invoke('resource', path),
  read: (id, limit) => invoke('read', id, limit),
  release: (id) => invoke('release', id),
  archive: (id) => invoke('archive', id),
  archiveEntry: (id, name) => invoke('archiveEntry', id, name),
  save: (state) => invoke('save', state),
  flushed: (token) => invoke('flushed', token),
  clipboardWrite: (paths, cut) => invoke('clipboardWrite', paths, cut),
  clipboardRead: () => invoke('clipboardRead'),
  textEdit: (command) => {
    document.execCommand(command);
    return Promise.resolve();
  },
  onEvent: (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
window.viewer = api;
await import('../src/renderer');
