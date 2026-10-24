// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { PluridApplicationHandle } from '@plurid/plurid-react';
import type { TreePlane } from '@plurid/plurid-data';
import type { CapturedTarget } from '../src/domain/automation/actions';
import type { FileEntry, ViewerAPI } from '../src/domain/contracts';
import {
  activeWorkspace,
  addPane,
  flushState,
  getState,
  initialize,
} from '../src/renderer/state/store';
import { replaceState } from '../src/renderer/state/core';
import { useWorkspaceController } from '../src/renderer/workspace/controller';

const stat = vi.fn<ViewerAPI['stat']>();
const publish = vi.fn();
let tree: TreePlane[];
const node = (id: string) =>
  ({
    planeID: `engine-${id}`,
    routeDivisions: { plane: { parameters: { id } }, path: { parameters: {} } },
  }) as unknown as TreePlane;
const file = (path = '/fixtures/notes.txt'): FileEntry => ({
  path,
  parent: '/fixtures',
  name: 'notes.txt',
  extension: 'txt',
  kind: 'file',
  directory: false,
  size: 3,
  created: 1,
  modified: 1,
  hidden: false,
  mime: 'text/plain',
  identity: 'generated-file',
});

function mountController() {
  // Hold the external engine tree one commit behind host records, as it is during a CLI launch.
  const engine = {
    current: {
      tree: { get: () => tree, open: vi.fn() },
      camera: { docked: () => undefined },
      pubsub: { publish },
    } as unknown as PluridApplicationHandle,
  };
  return renderHook(() =>
    useWorkspaceController({
      engine,
      surface: { current: null },
      readyRef: { current: true },
    }),
  ).result.current;
}

function rootTerminal(): CapturedTarget {
  return {
    workspaceID: activeWorkspace().id,
    paneID: 'none',
    rootID: 'none',
    directory: '/fixtures',
    selection: [],
  };
}

function emptyWorkspace() {
  const state = getState();
  replaceState({
    ...state,
    activePane: '',
    saved: {
      ...state.saved,
      workspaces: state.saved.workspaces.map((space) => ({ ...space, panes: [], roots: [] })),
    },
  });
  tree = [];
}

beforeEach(() => {
  stat.mockReset().mockImplementation(async (path) => file(path));
  publish.mockReset();
  Object.assign(window, { viewer: { save: vi.fn(async () => {}), stat } });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
  tree = activeWorkspace().roots.map(node);
});

afterEach(async () => {
  cleanup();
  await flushState(false);
});

describe('CLI launches through the workspace controller', () => {
  it.each([true, false])('adds an independent terminal when empty=%s', (empty) => {
    if (empty) emptyWorkspace();
    const controller = mountController();
    const before = activeWorkspace().panes.length;
    act(() => controller.newTerminal(rootTerminal()));
    const terminal = activeWorkspace().panes.find((pane) => pane.type === 'terminal')!;
    expect(activeWorkspace().panes).toHaveLength(before + 1);
    expect(terminal.path).toBe('/fixtures');
    expect(activeWorkspace().roots).toContain(terminal.id);
    expect(controller.rootID(terminal.id)).toBe(terminal.id);
    expect(publish).not.toHaveBeenCalled();
  });

  it('retains legacy root targets and rejects inconsistent or stale linked origins before creating a terminal', () => {
    const controller = mountController();
    const origin = activeWorkspace().panes[0]!;
    const base = rootTerminal();
    const before = activeWorkspace().panes.length;
    for (const target of [
      { ...base, panePath: '/fixtures' },
      { ...base, selection: [file()] },
      { ...base, rootID: origin.id },
      { ...base, paneID: origin.id },
      { ...base, paneID: origin.id, rootID: 'wrong-root', panePath: origin.path },
      { ...base, paneID: origin.id, rootID: origin.id, panePath: '/stale' },
    ]) {
      expect(() => controller.newTerminal(target)).toThrow();
      expect(activeWorkspace().panes).toHaveLength(before);
    }
    act(() => controller.newTerminal({ ...base, paneID: '', rootID: '' }));
    expect(activeWorkspace().panes).toHaveLength(before + 1);
    const after = activeWorkspace().panes.length;
    controller.newTerminal({ ...base, workspaceID: 'stale-workspace' });
    expect(activeWorkspace().panes).toHaveLength(after);
  });

  it('reuses concurrent and immediately repeated normalized root opens before engine hydration', async () => {
    emptyWorkspace();
    const controller = mountController();
    await act(async () => {
      await Promise.all([
        controller.openPath('/fixtures/notes.txt'),
        controller.openPath('/fixtures/./notes.txt'),
      ]);
    });
    expect(tree).toEqual([]);
    expect(activeWorkspace().panes).toHaveLength(1);
    const preview = activeWorkspace().panes[0]!;
    await act(async () => controller.openPath('/fixtures/notes.txt'));
    expect(activeWorkspace().panes.map((pane) => pane.id)).toEqual([preview.id]);
    expect(activeWorkspace().roots).toEqual([preview.id]);
    act(() => controller.open(file(), undefined, { another: true }));
    expect(activeWorkspace().panes).toHaveLength(2);
    const separate = activeWorkspace().panes[1]!;
    expect(separate.id).not.toBe(preview.id);
    expect(separate).toMatchObject({ type: 'preview', keepSeparate: true });
    act(() => controller.open(file()));
    expect(activeWorkspace().panes).toHaveLength(2);
    expect(getState().activePane).toBe(separate.id);
  });

  it('keeps preview reuse scoped to each independent folder root', () => {
    const first = activeWorkspace().panes[0]!;
    const second = addPane('/fixtures/other', 'folder', true);
    tree = activeWorkspace().roots.map(node);
    const controller = mountController();
    act(() => {
      controller.open(file(), first.id);
      controller.open(file(), second.id);
      controller.open(file(), first.id);
    });
    const previews = activeWorkspace().panes.filter((pane) => pane.type === 'preview');
    expect(previews).toHaveLength(2);
    expect(controller.rootID(previews[0]!.id)).toBe(first.id);
    expect(controller.rootID(previews[1]!.id)).toBe(second.id);
    act(() => controller.open(file(), first.id, { another: true }));
    expect(activeWorkspace().panes.filter((pane) => pane.type === 'preview')).toHaveLength(3);
    expect(activeWorkspace().roots).toHaveLength(3);
  });
});
