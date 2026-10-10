import { contextBridge, ipcRenderer } from 'electron';
import type { ApiMethod, ApiResult, DesktopEvent, ViewerAPI } from './domain/contracts';
async function invoke<T>(method: ApiMethod, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke('viewer:request', method, args)) as ApiResult<T>;
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
const api: ViewerAPI = {
  bootstrap: () => invoke('bootstrap'),
  list: (file) => invoke('list', file),
  stat: (file) => invoke('stat', file),
  chooseFolder: () => invoke('chooseFolder'),
  reveal: (file) => invoke('reveal', file),
  openExternal: (file) => invoke('openExternal', file),
  watch: (file, subscriber) => invoke('watch', file, subscriber),
  unwatch: (subscriber) => invoke('unwatch', subscriber),
  search: (request) => invoke('search', request),
  cancelSearch: (id) => invoke('cancelSearch', id),
  operate: (request) => invoke('operate', request),
  jobs: () => invoke('jobs'),
  cancelJob: (id) => invoke('cancelJob', id),
  resolveCollision: (id, decision, all) => invoke('resolveCollision', id, decision, all),
  undo: (id) => invoke('undo', id),
  resource: (file) => invoke('resource', file),
  read: (id, limit) => invoke('read', id, limit),
  release: (id) => invoke('release', id),
  archive: (id) => invoke('archive', id),
  archiveEntry: (id, name) => invoke('archiveEntry', id, name),
  save: (state) => invoke('save', state),
  flushed: (token) => invoke('flushed', token),
  clipboardWrite: (files, cut) => invoke('clipboardWrite', files, cut),
  clipboardRead: () => invoke('clipboardRead'),
  onEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, event: DesktopEvent) => listener(event);
    ipcRenderer.on('viewer:event', handler);
    return () => ipcRenderer.removeListener('viewer:event', handler);
  },
};
contextBridge.exposeInMainWorld('viewer', Object.freeze(api));
