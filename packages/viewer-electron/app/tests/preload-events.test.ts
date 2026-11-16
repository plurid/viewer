import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import type { ViewerAPI } from '../src/domain/contracts';
import { WorkspaceSessions } from '../src/desktop/windows/workspace-sessions';
import { schemas } from '../src/desktop/ipc/schemas';

const bridge = vi.hoisted(() => ({ api: undefined as ViewerAPI | undefined }));
const ipc = Object.assign(new EventEmitter(), { invoke: vi.fn() });
vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: ViewerAPI) => {
      bridge.api = api;
    },
  },
  ipcRenderer: ipc,
  sharedTexture: undefined,
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

it('forwards bounded visit save metadata and returns the acknowledged totals across preload', async () => {
  await import('../src/preload');
  const sessions = new WorkspaceSessions();
  const state = sessions.open(1, '/fixtures');
  const metadata = {
    id: 'visit-save',
    base: { '/fixtures': { count: 10, last: 100 } },
    clear: true,
  };
  const visits = { '/fixtures': { count: 1, last: 101 } };
  const history = { visits, revision: 0 };
  ipc.invoke.mockResolvedValueOnce({ ok: true, value: history });
  expect(await bridge.api!.save(state, metadata)).toEqual(history);
  expect(ipc.invoke).toHaveBeenCalledExactlyOnceWith('viewer:request', 'save', [state, metadata]);
  expect(schemas.save.parse([state, metadata])[1]).toEqual(metadata);
  expect(
    schemas.save.safeParse([state, { ...metadata, base: { relative: visits['/fixtures'] } }])
      .success,
  ).toBe(false);
  expect(
    schemas.save.safeParse([
      state,
      {
        ...metadata,
        base: Object.fromEntries(
          Array.from({ length: 501 }, (_, index) => [`/fixtures/${index}`, visits['/fixtures']]),
        ),
      },
    ]).success,
  ).toBe(false);
});
