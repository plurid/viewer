// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { PluridApplicationHandle } from '@plurid/plurid-react';
import type { TreePlane } from '@plurid/plurid-data';
import { PLURID_PUBSUB_TOPIC } from '@plurid/plurid-data';
import type { CapturedTarget } from '../src/domain/automation/actions';
import type { DesktopEvent, FileEntry, ServerPane, ViewerAPI } from '../src/domain/contracts';
import type { LocalServer } from '../src/domain/previews/web';
import {
  activeWorkspace,
  flushState,
  getState,
  initialize,
  navigate,
} from '../src/renderer/state/store';
import { useWorkspaceController } from '../src/renderer/workspace/controller';

let tree: TreePlane[];
let api: ReturnType<typeof nativeAPI>;
const publish = vi.fn();
const folderEntry = (path = '/fixture', identity = '1:2'): FileEntry => ({
  path,
  name: path.split('/').at(-1)!,
  parent: '/fixture',
  extension: '',
  kind: 'directory',
  directory: true,
  size: 0,
  created: 1,
  modified: 1,
  hidden: false,
  mime: 'inode/directory',
  identity,
});
const node = (id: string): TreePlane =>
  ({
    planeID: `engine-${id}`,
    children: [],
    routeDivisions: { plane: { parameters: { id } }, path: { parameters: {} } },
  }) as unknown as TreePlane;

function nativeAPI() {
  const records = new Map<string, LocalServer>();
  const listeners = new Set<(event: DesktopEvent) => void>();
  const changed = () => {
    for (const listener of listeners)
      listener({ type: 'local-servers', servers: [...records.values()] });
  };
  return {
    save: vi.fn(async () => {}),
    stat: vi.fn<ViewerAPI['stat']>(async (path) => folderEntry(path)),
    onEvent: vi.fn<ViewerAPI['onEvent']>((listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    localServers: vi.fn<ViewerAPI['localServers']>(async () => [...records.values()]),
    localServerStart: vi.fn<ViewerAPI['localServerStart']>(async (root, paneID) => {
      const server: LocalServer = {
        id: `native-${paneID}`,
        paneID,
        root,
        url: 'http://127.0.0.1:43110/',
        port: 43110,
        state: 'running',
        started: 1,
      };
      records.set(server.id, server);
      changed();
      return server;
    }),
    localServerInspect: vi.fn<ViewerAPI['localServerInspect']>(async (id) => ({
      server: records.get(id)!,
      logs: [],
    })),
    localServerAction: vi.fn<ViewerAPI['localServerAction']>(async (id, action) => {
      if (action === 'close') records.delete(id);
      changed();
    }),
  };
}

function mount() {
  const engine = {
    current: {
      tree: {
        get: () => tree,
        open: vi.fn(),
        remove: vi.fn(() => {
          tree = [];
        }),
      },
      camera: { docked: () => undefined },
      pubsub: { publish },
    } as unknown as PluridApplicationHandle,
  };
  return renderHook(() =>
    useWorkspaceController({ engine, surface: { current: null }, readyRef: { current: true } }),
  ).result.current;
}
function target(selection: FileEntry[] = []): CapturedTarget {
  const pane = activeWorkspace().panes[0]!;
  return {
    workspaceID: activeWorkspace().id,
    rootID: pane.id,
    paneID: pane.id,
    panePath: pane.path,
    directory: selection[0]?.path ?? pane.path,
    selection,
  };
}

beforeEach(() => {
  api = nativeAPI();
  publish.mockReset();
  Object.assign(window, { viewer: api });
  initialize({ home: '/fixture', platform: 'darwin', locations: [], openPaths: [], state: null });
  tree = activeWorkspace().roots.map(node);
});
afterEach(async () => {
  cleanup();
  await flushState(false);
});

describe('linked local server creation', () => {
  it('creates a linked Plurid child with a retained source identity and no persisted runtime data', async () => {
    const source = activeWorkspace().panes[0]!;
    const controller = mount();
    await act(async () => controller.newServer(target()));
    const pane = activeWorkspace().panes.find(
      (pane): pane is ServerPane => pane.type === 'server',
    )!;
    expect(activeWorkspace().roots).toEqual([source.id]);
    expect(Object.keys(pane).sort()).toEqual(['id', 'path', 'sourceIdentity', 'type']);
    expect(pane.sourceIdentity).toBe('1:2');
    expect(controller.rootID(pane.id)).toBe(source.id);
    expect(publish).toHaveBeenCalledWith({
      topic: PLURID_PUBSUB_TOPIC.SPACE_SPAWN_PLANE,
      data: { route: `/servers/${pane.id}`, parentPlaneID: `engine-${source.id}`, framing: 'none' },
    });
    expect(api.localServerStart).toHaveBeenCalledWith('/fixture', pane.id, '1:2');
    await flushState(false);
    expect(JSON.stringify(getState().saved)).not.toContain('43110');
    expect(JSON.stringify(getState().saved)).not.toContain(`native-${pane.id}`);
  });

  it('reuses concurrent and immediately repeated creation before the engine hydrates the child', async () => {
    const controller = mount();
    const captured = target();
    await act(async () => {
      await Promise.all([controller.newServer(captured), controller.newServer(captured)]);
    });
    await act(async () => controller.newServer(captured));
    expect(activeWorkspace().panes.filter((pane) => pane.type === 'server')).toHaveLength(1);
    expect(api.localServerStart).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('rejects a replaced selection and an origin changed while the folder stat was pending', async () => {
    const controller = mount();
    api.stat.mockResolvedValueOnce(folderEntry('/fixture/site', 'replacement'));
    await expect(controller.newServer(target([folderEntry('/fixture/site')]))).rejects.toThrow(
      'selected folder changed',
    );
    let finish!: (entry: FileEntry) => void;
    api.stat.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const captured = target();
    const starting = controller.newServer(captured);
    const rejected = expect(starting).rejects.toThrow('originating folder changed');
    act(() => navigate(captured.paneID, '/fixture/elsewhere'));
    finish(folderEntry('/fixture'));
    await rejected;
    expect(api.localServerStart).not.toHaveBeenCalled();
    expect(activeWorkspace().panes.some((pane) => pane.type === 'server')).toBe(false);
  });

  it('disposes late native startup when its parent closes before engine hydration', async () => {
    const controller = mount();
    const captured = target();
    let finish!: (server: LocalServer) => void;
    api.localServerStart.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const starting = controller.newServer(captured);
    await vi.waitFor(() => expect(api.localServerStart).toHaveBeenCalledTimes(1));
    const paneID = api.localServerStart.mock.calls[0]![1];
    act(() => controller.closePane(captured.paneID));
    finish({
      id: 'late-native',
      paneID,
      root: '/fixture',
      url: 'http://127.0.0.1:43110/',
      port: 43110,
      started: 1,
      state: 'running',
    });
    await starting;
    expect(activeWorkspace().panes).toEqual([]);
    expect(api.localServerAction).toHaveBeenCalledWith('late-native', 'close');
  });
});
