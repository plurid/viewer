import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import type { ViewerAPI } from '../src/domain/contracts';

const bridge = vi.hoisted(() => ({ api: undefined as ViewerAPI | undefined }));
const ipc = new EventEmitter();
vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: ViewerAPI) => {
      bridge.api = api;
    },
  },
  ipcRenderer: ipc,
  webUtils: {},
}));

it('shares one native event subscription among many planes and releases it after the last subscriber', async () => {
  await import('../src/preload');
  const callbacks = Array.from({ length: 24 }, () => vi.fn());
  const stops = callbacks.map((callback) => bridge.api!.onEvent(callback));
  expect(ipc.listenerCount('viewer:event')).toBe(1);
  ipc.emit('viewer:event', {}, { type: 'folder-changed', path: '/fixtures' });
  for (const callback of callbacks) expect(callback).toHaveBeenCalledOnce();
  for (const stop of stops.slice(0, -1)) stop();
  expect(ipc.listenerCount('viewer:event')).toBe(1);
  stops.at(-1)!();
  expect(ipc.listenerCount('viewer:event')).toBe(0);
});
