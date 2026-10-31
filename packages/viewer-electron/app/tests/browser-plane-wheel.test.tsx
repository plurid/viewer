// @vitest-environment jsdom
/**
 * THE WHEEL OVER A BROWSER PLANE, ON THE REAL ENGINE: Plurid's application (0.0.0-43) with the
 * workspace surface's configuration, and a browser plane in one of its planes. In click-to-scroll
 * the engine stops a wheel it gives a plane at its view, before React's root listener sees it.
 */
import { act, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  configurationWith,
  flushFrames,
  gestures,
  installFrameClock,
  renderPlurid,
} from '@plurid/plurid-react/testing';
import type { RenderedPlurid } from '@plurid/plurid-react/testing';
import BrowserPlane from '../src/renderer/browser/BrowserPlane';
import { CURRENT_STATE_VERSION } from '../src/domain/contracts';
import { normalizePreferences } from '../src/domain/preferences/ui';
import type { BrowserRequest } from '../src/domain/previews/browser';
import { flushState, initialize } from '../src/renderer/state/store';
import { surfaceConfiguration } from '../src/renderer/workspace/surface-configuration';

vi.mock('../src/renderer/browser/runtime', () => ({ connectBrowsers() {} }));
vi.mock('../src/renderer/browser/frames', () => ({ browserFrames: () => () => {} }));
vi.mock('../src/renderer/local-servers/runtime', () => ({
  localServerSessions: () => ({
    subscribeAll: () => () => {},
    generation: () => 0,
    snapshot: () => ({}),
  }),
}));

type BrowserInput = Extract<BrowserRequest, { kind: 'input' }>['event'];

const pane = {
  id: 'browser',
  type: 'browser' as const,
  path: '/fixture',
  url: 'http://127.0.0.1:1234/',
};
const BrowserHost = () => createElement(BrowserPlane, { pane, active: true });
const requests: BrowserRequest[] = [];
const pageWheels = () =>
  requests.flatMap((request) =>
    request.kind === 'input' && request.event.type === 'mouseWheel' ? [request.event] : [],
  );
let rendered: RenderedPlurid | undefined;
let clock: ReturnType<typeof installFrameClock> | undefined;

beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
      browser: vi.fn(async (request: BrowserRequest) => {
        requests.push(request);
      }),
      onEvent: () => () => {},
    },
  });
  initialize({
    home: '/fixture',
    platform: 'darwin',
    locations: [],
    openPaths: [],
    state: {
      version: CURRENT_STATE_VERSION,
      look: 'dark',
      activeWorkspace: 'workspace',
      favorites: [],
      recents: [],
      workspaces: [
        {
          id: 'workspace',
          name: 'Generated workspace',
          roots: [pane.id],
          panes: [pane],
          arrangement: {},
        },
      ],
    },
  });
});
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
  clock?.restore();
  clock = undefined;
  cleanup();
  await flushState(false);
  vi.unstubAllGlobals();
});

it('scrolls the page under the clicked browser plane, and the space everywhere else', async () => {
  clock = installFrameClock();
  rendered = await renderPlurid({
    planes: [{ route: '/browsers/:id', component: BrowserHost }],
    view: ['/browsers/browser'],
    configuration: configurationWith(
      surfaceConfiguration({
        look: 'dark',
        size: { width: 1280, height: 800 },
        preferences: normalizePreferences().space,
        minimap: true,
      }),
    ),
  });
  await flushFrames(5);
  const canvas = rendered.container.querySelector('.browser-surface canvas')!;
  const plane = canvas.closest('[data-plurid-plane]')!;
  const camera = () => JSON.stringify(rendered!.handle.camera.get());
  const wheel = async (target: Element, init: WheelEventInit) => {
    await gestures.wheel(target, {
      deltaY: init.deltaY,
      ctrlKey: init.ctrlKey,
      metaKey: init.metaKey,
    });
    await flushFrames(30);
  };

  // Before a click the wheel moves the space and the page receives nothing.
  let before = camera();
  await wheel(canvas, { deltaY: 100 });
  expect(camera()).not.toBe(before);
  expect(pageWheels()).toEqual([]);

  // A click gives the plane the wheel: a mouse notch and a trackpad step scroll the page only.
  const press = { bubbles: true, cancelable: true, isPrimary: true, pointerId: 1, button: 0 };
  await act(async () => {
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...press, buttons: 1 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...press, buttons: 0 }));
  });
  expect(plane.getAttribute('data-plurid-scroll-selected')).toBe('true');
  before = camera();
  await wheel(canvas, { deltaY: 100 });
  await wheel(canvas, { deltaY: 7.5 });
  expect(pageWheels()).toEqual([
    expect.objectContaining<Partial<BrowserInput>>({ deltaY: 100, modifiers: 0 }),
    expect.objectContaining<Partial<BrowserInput>>({ deltaY: 7.5, modifiers: 0 }),
  ]);
  expect(camera()).toBe(before);

  // A pinch zooms the space; a ⌘ wheel reaches the page with ⌘ held.
  await wheel(canvas, { deltaY: -4.5, ctrlKey: true });
  expect(camera()).not.toBe(before);
  expect(pageWheels()).toHaveLength(2);
  before = camera();
  await wheel(canvas, { deltaY: 100, metaKey: true });
  expect(pageWheels().at(-1)).toEqual(
    expect.objectContaining<Partial<BrowserInput>>({ deltaY: 100, modifiers: 4 }),
  );
  expect(camera()).toBe(before);

  // Outside the plane, once that wheel stream has ended, the wheel moves the space again.
  await flushFrames(1, 400);
  await wheel(rendered.view!, { deltaY: 100 });
  expect(camera()).not.toBe(before);
  expect(pageWheels()).toHaveLength(3);
});
