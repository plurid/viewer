import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import type { ViewerAPI } from '../src/domain/contracts';
import { WorkspaceSessions } from '../src/desktop/windows/workspace-sessions';
import { schemas, settingsEvents, methodWindows } from '../src/desktop/ipc/schemas';
import { sampleDefinition } from './workspace-definition-fixtures';

const bridge = vi.hoisted(() => ({
  api: undefined as ViewerAPI | undefined,
  exposed: {} as Record<string, unknown>,
}));
const ipc = Object.assign(new EventEmitter(), { invoke: vi.fn() });
vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: ViewerAPI) => {
      bridge.exposed[name] = api;
      bridge.api = api;
    },
  },
  ipcRenderer: ipc,
  sharedTexture: undefined,
  webUtils: {},
}));

it('passes a basis-bound definition reference and Run all items through preload without shell text', async () => {
  await import('../src/preload');
  const request = {
    id: 'terminal',
    workspaceID: 'workspace',
    rootID: 'terminal',
    cwd: '/fixture',
    profileID: 'login',
    cols: 80,
    rows: 24,
  };
  const reference = { key: 'sample/site', plane: 0, basis: 'shown-basis' };
  ipc.invoke.mockResolvedValue({ ok: true });
  await bridge.api!.terminalStart(request, reference);
  expect(ipc.invoke).toHaveBeenLastCalledWith('viewer:request', 'terminalStart', [
    request,
    reference,
  ]);
  await bridge.api!.terminalStartAll([{ request, ...reference }]);
  expect(ipc.invoke).toHaveBeenLastCalledWith('viewer:request', 'terminalStartAll', [
    [{ request, ...reference }],
  ]);
  await bridge.api!.terminalStart(request);
  expect(ipc.invoke).toHaveBeenLastCalledWith('viewer:request', 'terminalStart', [request]);
  expect(methodWindows.terminalStartAll).toBe('viewer');
  await bridge.api!.terminalRunning(request);
  expect(ipc.invoke).toHaveBeenLastCalledWith('viewer:request', 'terminalRunning', [request]);
  await bridge.api!.terminalCount(request.workspaceID);
  expect(ipc.invoke).toHaveBeenLastCalledWith('viewer:request', 'terminalCount', ['workspace']);
  expect(methodWindows.terminalRunning).toBe('viewer');
  expect(methodWindows.terminalCount).toBe('viewer');
  await bridge.api!.terminalStatus(request, true);
  expect(ipc.invoke).toHaveBeenLastCalledWith('viewer:request', 'terminalStatus', [request, true]);
  await bridge.api!.terminalDefinitionCommand(request, reference);
  expect(ipc.invoke).toHaveBeenLastCalledWith('viewer:request', 'terminalDefinitionCommand', [
    request,
    reference,
  ]);
  expect(methodWindows.terminalStatus).toBe('viewer');
  expect(methodWindows.terminalDefinitionCommand).toBe('viewer');
  expect(
    schemas.terminalStatus.safeParse([{ ...request, initialInput: 'echo forged' }]).success,
  ).toBe(false);
  expect(
    schemas.terminalDefinitionCommand.safeParse([request, { ...reference, command: 'echo forged' }])
      .success,
  ).toBe(false);
  expect(
    schemas.terminalRunning.safeParse([{ ...request, initialInput: 'echo forged' }]).success,
  ).toBe(false);
});

it('forwards declared-command discovery as a directory-only workspace request', async () => {
  await import('../src/preload');
  ipc.invoke.mockResolvedValue({ ok: true, value: { commands: [] } });
  await expect(bridge.api!.declaredCommands('/projects/sample')).resolves.toEqual({ commands: [] });
  expect(ipc.invoke).toHaveBeenLastCalledWith('viewer:request', 'declaredCommands', [
    '/projects/sample',
  ]);
  expect(methodWindows.declaredCommands).toBe('viewer');
});

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

it('forwards workspace definitions to Settings and exposes only bounded open and file requests', async () => {
  await import('../src/preload');
  const listener = vi.fn();
  const stop = bridge.api!.onEvent(listener);
  const event = {
    type: 'workspace-definitions',
    catalog: { revision: 1, definitions: [sampleDefinition()] },
  };
  ipc.emit('viewer:event', {}, event);
  expect(listener).toHaveBeenCalledWith(event);
  expect(settingsEvents).toContain('workspace-definitions');
  expect(methodWindows.workspaceDefinitions).toBe('viewer');
  expect(methodWindows.workspaceDefinitionFile).toBe('both');
  ipc.invoke.mockResolvedValueOnce({ ok: true, value: { kind: 'elsewhere' } });
  await bridge.api!.workspaceDefinitions({ kind: 'open', key: 'sample/site' });
  expect(ipc.invoke).toHaveBeenLastCalledWith('viewer:request', 'workspaceDefinitions', [
    { kind: 'open', key: 'sample/site' },
  ]);
  ipc.invoke.mockResolvedValueOnce({ ok: true, value: event.catalog });
  await bridge.api!.workspaceDefinitionFile({ kind: 'catalog' });
  expect(ipc.invoke).toHaveBeenLastCalledWith('viewer:request', 'workspaceDefinitionFile', [
    { kind: 'catalog' },
  ]);
  expect(
    schemas.workspaceDefinitions.safeParse([
      { kind: 'open', key: 'sample/site', command: 'echo example' },
    ]).success,
  ).toBe(false);
  expect(
    schemas.workspaceDefinitions.safeParse([{ kind: 'reset', key: 'sample/site' }]).success,
  ).toBe(false);
  expect(
    schemas.workspaceDefinitionFile.safeParse([{ kind: 'validate', path: '/elsewhere' }]).success,
  ).toBe(false);
  stop();
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

it('tags IPC requests with the active viewerDispatch ID and omits it once cleared', async () => {
  await import('../src/preload');
  const dispatch = bridge.exposed.viewerDispatch as { set(id: string | undefined): void };
  expect(Object.isFrozen(dispatch)).toBe(true);
  ipc.invoke.mockResolvedValue({ ok: true, value: { commands: [] } });
  dispatch.set('dispatch-42');
  try {
    await bridge.api!.declaredCommands('/projects/sample');
    expect(ipc.invoke).toHaveBeenLastCalledWith(
      'viewer:request',
      'declaredCommands',
      ['/projects/sample'],
      'dispatch-42',
    );
  } finally {
    dispatch.set(undefined);
  }
  await bridge.api!.declaredCommands('/projects/sample');
  expect(ipc.invoke).toHaveBeenLastCalledWith('viewer:request', 'declaredCommands', [
    '/projects/sample',
  ]);
});
