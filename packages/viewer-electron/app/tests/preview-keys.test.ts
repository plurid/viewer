// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { createElement, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { FileEntry } from '../src/domain/contracts';
import { defaultSettings } from '../src/domain/services';
import { parseDrawing } from '../src/domain/dxf/geometry';
import { panelDrawing } from './dxf-fixtures';

// A preview with what answers keys in one: a focusable drawing, an image that answers none, and a
// panel that closes on Escape itself, as the model shading panel does.
vi.mock('../src/renderer/previews/PreviewHost', async () => {
  const { createElement } = await import('react');
  return {
    PreviewHost: ({ path }: { path: string }) =>
      createElement(
        'div',
        { className: 'preview-host' },
        createElement('canvas', { tabIndex: 0, 'data-drawing': path }),
        createElement('div', { tabIndex: 0, 'data-image': path }),
        createElement('section', {
          tabIndex: 0,
          'data-panel': path,
          onKeyDown: (event: ReactKeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
          },
        }),
      ),
  };
});
vi.mock('../src/renderer/workspace/LinkedPlaneButton', () => ({ LinkedPlaneButton: () => null }));

import { GalleryView, type FileViewProps } from '../src/renderer/explorer/views';
import { routeExplorerInput } from '../src/renderer/explorer/input';
import { QuickPreview } from '../src/renderer/previews/QuickPreview';
import { WorkspaceContext } from '../src/renderer/workspace/context';
import { createDrawingCanvas } from '../src/renderer/previews/dxf/canvas';
import { getState, initialize, quickPreview } from '../src/renderer/state/store';

// jsdom has no modal dialogs; opening one only needs the `open` attribute here.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
};
const drawingEntry = (name: string): FileEntry => ({
  path: `/fixtures/${name}`,
  name,
  parent: '/fixtures',
  extension: 'dxf',
  mime: 'image/vnd.dxf',
  size: 10,
  kind: 'file',
  directory: false,
  identity: `1:${name}`,
  modified: 0,
  created: 0,
  hidden: false,
});
const press = (target: Element, key: string) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};
beforeEach(() => {
  Object.assign(window, { viewer: { save: vi.fn(async () => {}) } });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('keys in a preview', () => {
  it('in a view, reach what has the focus and stop at the preview’s edge', () => {
    // The explorer stopped a preview's arrows while they were capturing, to keep them from the space:
    // a focused drawing in Gallery or Columns could not pan with them or reframe with Home.
    const entry = drawingEntry('plan.dxf');
    const input = {
      settings: defaultSettings('/fixtures'),
      command: vi.fn(),
      move: vi.fn(),
      clear: vi.fn(),
      horizontal: vi.fn(),
    };
    const props = {
      paneID: 'pane',
      entries: [entry],
      selection: [entry.path],
      cursor: entry.path,
      selectionSet: new Set([entry.path]),
      select: vi.fn(),
      open: vi.fn(),
      context: vi.fn(),
      drag: vi.fn(),
      showHidden: false,
    } as FileViewProps;
    const view = render(
      // Plurid's space listens on its view, natively, while keys bubble; the explorer routes them
      // while they capture, as FolderExplorer does.
      createElement(
        'div',
        { 'data-space': '' },
        createElement(
          'div',
          { onKeyDownCapture: (event: ReactKeyboardEvent) => routeExplorerInput(event, input) },
          createElement(GalleryView, props),
        ),
      ),
    );
    const heard: string[] = [];
    view.container
      .querySelector('[data-space]')!
      .addEventListener('keydown', (event) => heard.push('space ' + (event as KeyboardEvent).key));
    const canvas = view.container.querySelector('canvas')!;
    canvas.addEventListener('keydown', (event) => heard.push('drawing ' + event.key));
    for (const key of ['ArrowLeft', 'Home', 'PageDown']) press(canvas, key);
    press(view.container.querySelector('[data-image]')!, 'ArrowRight');
    expect(heard).toEqual(['drawing ArrowLeft', 'drawing Home', 'drawing PageDown']);
    expect(input.move).not.toHaveBeenCalled();
    expect(input.horizontal).not.toHaveBeenCalled();
  });

  it('in Quick Preview, are answered first by what has the focus', () => {
    // Quick Preview took Space, Escape and the side arrows at the window while they captured: a
    // focused drawing stepped to another file instead of panning, and Escape in the shading panel
    // closed Quick Preview instead of the panel.
    quickPreview(
      ['a.dxf', 'b.dxf', 'c.dxf'].map((name) => `/fixtures/${name}`),
      {
        workspaceID: getState().saved.activeWorkspace,
      },
    );
    const view = render(
      createElement(
        WorkspaceContext.Provider,
        { value: {} as never },
        createElement(QuickPreview, { session: getState().quickPreview! }),
      ),
    );
    const canvas = view.baseElement.querySelector('canvas')!;
    // the drawing answers its own keys and stops them, as the DXF canvas does
    canvas.addEventListener('keydown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    const image = view.baseElement.querySelector('[data-image]')!;
    press(canvas, 'ArrowRight');
    expect(getState().quickPreview?.index).toBe(0);
    press(image, 'ArrowRight');
    expect(getState().quickPreview?.index).toBe(1);
    press(image, 'ArrowLeft');
    expect(getState().quickPreview?.index).toBe(0);
    press(view.baseElement.querySelector('[data-panel]')!, 'Escape');
    expect(getState().quickPreview).not.toBeNull();
    expect(press(image, 'Escape').defaultPrevented).toBe(true);
    expect(getState().quickPreview).toBeNull();
  });

  it('a drawing with no draft to cancel leaves Escape to its host, and keeps its arrows', () => {
    // A drawing took every Escape, so with nothing to cancel a focused one could not close Quick
    // Preview or leave its plane.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      new Proxy({}, { get: () => () => undefined }) as never,
    );
    vi.stubGlobal(
      'Path2D',
      class {
        moveTo() {}
        lineTo() {}
        closePath() {}
      },
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const stage = document.body.appendChild(document.createElement('div'));
    const canvas = stage.appendChild(document.createElement('canvas'));
    const host: string[] = [];
    stage.addEventListener('keydown', (event) => host.push(event.key));
    const drawing = createDrawingCanvas(
      stage,
      canvas,
      parseDrawing(panelDrawing),
      {
        active: true,
        interactive: true,
        look: 'light',
        tool: 'distance',
        grid: false,
        snap: true,
        hiddenLayers: [],
        measurements: [],
        unit: 4,
        displayUnit: 4,
      },
      { selected() {}, measurements() {}, draft() {}, view() {} },
    );
    expect(press(canvas, 'ArrowLeft').defaultPrevented).toBe(true);
    expect(press(canvas, 'Home').defaultPrevented).toBe(true);
    expect(press(canvas, 'Escape').defaultPrevented).toBe(false);
    expect(host).toEqual(['Escape']);
    drawing.dispose();
    stage.remove();
  });
});
