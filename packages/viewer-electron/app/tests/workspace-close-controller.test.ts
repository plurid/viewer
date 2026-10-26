// @vitest-environment jsdom
import type * as FramingModule from '../src/renderer/workspace/framing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { PluridApplicationHandle } from '@plurid/plurid-react';
import { pluridStateModules } from '@plurid/plurid-react';
import type { TreePlane } from '@plurid/plurid-data';
import type { Pane } from '../src/domain/contracts';
import { evidenceNavigationSchema, type SearchEvidence } from '../src/domain/files/inspection';
import {
  activeWorkspace,
  addPane,
  addTerminalPane,
  flushState,
  getState,
  initialize,
  setActivePane,
} from '../src/renderer/state/store';
import { useWorkspaceController } from '../src/renderer/workspace/controller';
import { frameWorkspace } from '../src/renderer/workspace/framing';
import { flattenTree, hostID } from '../src/renderer/workspace/tree';

vi.mock('../src/renderer/workspace/framing', async (original) => ({
  ...(await original<typeof FramingModule>()),
  frameWorkspace: vi.fn(),
}));

const frames = new Map<number, FrameRequestCallback>();
let frameID = 0;
const node = (id: string, children: TreePlane[] = []): TreePlane =>
  ({
    planeID: `engine-${id}`,
    show: true,
    children,
    routeDivisions: { plane: { parameters: { id } }, path: { parameters: {} } },
  }) as unknown as TreePlane;

beforeEach(() => {
  frames.clear();
  frameID = 0;
  vi.mocked(frameWorkspace).mockClear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameID, callback);
    return frameID;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  Object.assign(window, { viewer: { save: vi.fn(async () => {}) } });
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
afterEach(async () => {
  cleanup();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  await flushState(false);
});

function nextFrame() {
  const callbacks = [...frames.values()];
  frames.clear();
  for (const callback of callbacks) callback(0);
}

function mount(options: { git?: boolean; docked?: boolean; missingParent?: boolean } = {}) {
  // The unrelated root comes first in host order, exposing the previous arbitrary fallback.
  const unrelated = activeWorkspace().panes[0]!;
  const root = addPane('/fixture/project', 'folder', true);
  const parent = addPane('/fixture/project/source', 'folder', false);
  const child = options.git
    ? addTerminalPane('/fixture/project', '@viewer-git', false, {
        id: crypto.randomUUID(),
        gitAction: 'status',
      })
    : addPane('/fixture/project/source/notes.txt', 'preview', false);
  const parentNode = node(parent.id, [node(child.id)]);
  let tree = [
    node(unrelated.id),
    node(root.id, [options.missingParent ? node('unregistered-parent', [parentNode]) : parentNode]),
  ];
  const elements = new Map<string, HTMLElement>();
  for (const pane of activeWorkspace().panes) {
    const plane = document.createElement('section');
    plane.dataset.pluridPlane = `engine-${pane.id}`;
    const marker = document.createElement('div');
    marker.dataset.viewerPane = pane.id;
    const content = document.createElement('div');
    content.className =
      pane.type === 'folder'
        ? 'folder-explorer'
        : pane.type === 'terminal'
          ? 'terminal-plane'
          : 'preview-plane';
    content.tabIndex = 0;
    marker.append(content);
    plane.append(marker);
    document.body.append(plane);
    elements.set(pane.id, content);
  }
  let docked = options.docked ? `engine-${child.id}` : '';
  const dock = vi.fn((id: string) => {
    docked = id;
  });
  const dispatch = vi.fn();
  const open = vi.fn((id: string) => {
    const target = flattenTree(tree).find((item) => item.planeID === id);
    if (target) target.show = true;
  });
  const remove = vi.fn((id: string) => {
    const removed = flattenTree(tree).find((item) => item.planeID === id);
    const removedNodes = removed ? flattenTree([removed]) : [];
    const prune = (nodes: TreePlane[]): TreePlane[] =>
      nodes
        .filter((item) => item.planeID !== id)
        .map((item) => ({ ...item, children: prune(item.children ?? []) }));
    tree = prune(tree);
    for (const item of removedNodes) elements.get(hostID(item))?.closest('section')?.remove();
    if (removedNodes.some((item) => item.planeID === docked)) docked = '';
  });
  const transaction = vi.fn((work: () => void) => work());
  const engine = {
    current: {
      tree: { get: () => tree, open, remove },
      camera: { docked: () => docked, dock },
      store: { dispatch },
      history: { transaction },
    } as unknown as PluridApplicationHandle,
  };
  const surface = { current: document.createElement('div') };
  const controller = renderHook(() =>
    useWorkspaceController({ engine, surface, readyRef: { current: true } }),
  ).result.current;
  setActivePane(child.id);
  elements.get(child.id)!.focus();
  return {
    controller,
    engine,
    surface,
    unrelated,
    root,
    parent,
    child,
    parentNode,
    elements,
    dock,
    dispatch,
    remove,
    open,
    transaction,
  };
}

async function expectActive(view: ReturnType<typeof mount>, pane: Pane) {
  expect(getState().activePane).toBe(pane.id);
  expect(activeWorkspace().activePane).toBe(pane.id);
  await act(async () => {});
  expect(view.dispatch).toHaveBeenCalledWith(
    pluridStateModules.ui.actions.setScrollPlaneID(`engine-${pane.id}`),
  );
  nextFrame();
  expect(document.activeElement).toBe(view.elements.get(pane.id));
}

describe('closing a plane returns to its surviving context', () => {
  it('opens a search hit using only durable navigation fields', async () => {
    const view = mount();
    const evidence: SearchEvidence = {
      path: '/fixture/project/source/notes.txt',
      version: { identity: '1:2', modified: 1, size: 20 },
      anchor: { kind: 'text', line: 2, start: 0, end: 7 },
      quote: 'Orchard',
      coverage: 'complete',
    };
    Object.assign(window.viewer, {
      stat: vi.fn(async () => ({
        path: evidence.path,
        identity: evidence.version.identity,
        modified: evidence.version.modified,
        size: evidence.version.size,
      })),
    });
    const open = vi.spyOn(view.controller, 'open').mockImplementation(() => {});
    await view.controller.openEvidence(evidence, view.parent.id);
    const navigation = open.mock.calls[0]?.[2]?.evidence;
    expect(evidenceNavigationSchema.parse(navigation)).toEqual({
      path: evidence.path,
      version: evidence.version,
      anchor: evidence.anchor,
      quote: evidence.quote,
    });
    expect(evidence.coverage).toBe('complete');
  });

  it.each([false, true])(
    'returns an active linked plane to its immediate parent when Git=%s',
    async (git) => {
      const view = mount({ git });
      act(() => view.controller.closePane(view.child.id));
      await expectActive(view, view.parent);
      expect(frameWorkspace).toHaveBeenCalledExactlyOnceWith(view.engine, view.surface, [
        view.parent.id,
      ]);
      expect(view.remove).toHaveBeenCalledWith(`engine-${view.child.id}`);
      expect(activeWorkspace().panes.some((pane) => pane.id === view.child.id)).toBe(false);
    },
  );

  it('returns an active descendant to the nearest ancestor outside the closed subtree', async () => {
    const view = mount();
    act(() => view.controller.closePane(view.parent.id));
    await expectActive(view, view.root);
    expect(frameWorkspace).toHaveBeenCalledExactlyOnceWith(view.engine, view.surface, [
      view.root.id,
    ]);
    expect(activeWorkspace().panes.map((pane) => pane.id)).toEqual([
      view.unrelated.id,
      view.root.id,
    ]);
  });

  it('skips an engine ancestor without a surviving host record', async () => {
    const view = mount({ missingParent: true });
    act(() => view.controller.closePane(view.parent.id));
    await expectActive(view, view.root);
    expect(frameWorkspace).toHaveBeenCalledExactlyOnceWith(view.engine, view.surface, [
      view.root.id,
    ]);
  });

  it('does not change the camera, wheel owner or keyboard focus when an inactive branch closes', () => {
    const view = mount();
    setActivePane(view.unrelated.id);
    view.elements.get(view.unrelated.id)!.focus();
    act(() => view.controller.closePane(view.parent.id));
    expect(getState().activePane).toBe(view.unrelated.id);
    nextFrame();
    expect(document.activeElement).toBe(view.elements.get(view.unrelated.id));
    expect(frameWorkspace).not.toHaveBeenCalled();
    expect(view.dock).not.toHaveBeenCalled();
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it('transfers docking even if engine removal already cleared the previous dock', async () => {
    const view = mount({ git: true, docked: true });
    act(() => view.controller.closePane(view.child.id));
    await expectActive(view, view.parent);
    expect(view.dock).toHaveBeenCalledExactlyOnceWith(`engine-${view.parent.id}`, {
      animate: true,
    });
    expect(frameWorkspace).not.toHaveBeenCalled();
  });

  it('frames the existing fallback after an active independent root closes without inventing a parent', async () => {
    const view = mount();
    setActivePane(view.root.id);
    view.elements.get(view.root.id)!.focus();
    act(() => view.controller.closePane(view.root.id));
    await expectActive(view, view.unrelated);
    expect(frameWorkspace).toHaveBeenCalledExactlyOnceWith(view.engine, view.surface, [
      view.unrelated.id,
    ]);
    expect(activeWorkspace().roots).toEqual([view.unrelated.id]);
    expect(view.controller.parentPaneID(view.unrelated.id)).toBeUndefined();
  });

  it('opens a hidden parent within the same close transaction and retains captured activation', async () => {
    const view = mount();
    view.parentNode.show = false;
    const remove = view.remove.getMockImplementation()!;
    view.remove.mockImplementation((id) => {
      remove(id);
      // An engine removal subscriber may clear/reassign active state before host removal.
      setActivePane(view.unrelated.id);
    });
    act(() => view.controller.closePane(view.child.id));
    await expectActive(view, view.parent);
    expect(view.open).toHaveBeenCalledWith(`engine-${view.parent.id}`);
    expect(view.transaction).toHaveBeenCalledTimes(1);
  });

  it('retains the first-survivor fallback when an engine subscriber clears activation during removal', async () => {
    const view = mount();
    setActivePane(view.root.id);
    const remove = view.remove.getMockImplementation()!;
    view.remove.mockImplementation((id) => {
      remove(id);
      setActivePane('');
    });
    act(() => view.controller.closePane(view.root.id));
    await expectActive(view, view.unrelated);
    expect(frameWorkspace).toHaveBeenCalledExactlyOnceWith(view.engine, view.surface, [
      view.unrelated.id,
    ]);
  });

  it('clears the final root without framing or retrying focus for intermediate closed fallbacks', async () => {
    const view = mount();
    setActivePane(view.unrelated.id);
    act(() => view.controller.closePane(view.unrelated.id));
    vi.mocked(frameWorkspace).mockClear();
    view.dispatch.mockClear();
    act(() => view.controller.closePane(view.root.id));
    await act(async () => {});
    expect(activeWorkspace().panes).toEqual([]);
    expect(getState().activePane).toBe('');
    expect(frameWorkspace).not.toHaveBeenCalled();
    expect(view.dispatch).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    const before = view.remove.mock.calls.length;
    act(() => view.controller.closePane('already-closed'));
    expect(view.remove).toHaveBeenCalledTimes(before);
  });
});
