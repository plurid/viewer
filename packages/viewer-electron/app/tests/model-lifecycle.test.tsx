// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import ModelPreview from '../src/renderer/previews/modules/ModelPreview';
import type { PreviewContext } from '../src/renderer/previews/contracts';

const disposedWhileConnected = vi.hoisted(() => [] as boolean[]);
vi.mock('three', async (original) => ({
  ...(await original<typeof import('three')>()),
  // Keep real OrbitControls and React teardown; only WebGL is absent in jsdom.
  WebGLRenderer: class {
    domElement = document.createElement('canvas');
    shadowMap = { enabled: false, type: 0 };
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {
      disposedWhileConnected.push(this.domElement.isConnected);
    }
    forceContextLoss() {}
  },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  disposedWhileConnected.length = 0;
});

it('releases document orbit listeners before React detaches a model canvas', () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'fetch',
    (_url: string, options: { signal: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        options.signal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      }),
  );
  const added = vi.spyOn(document, 'addEventListener');
  const removed = vi.spyOn(document, 'removeEventListener');
  const context: PreviewContext = {
    resource: {
      id: 'model',
      url: 'https://fixture.invalid/model.glb',
      entry: {
        path: '/fixture/model.glb',
        name: 'model.glb',
        parent: '/fixture',
        extension: 'glb',
        kind: 'file',
        directory: false,
        size: 100,
        modified: 1,
        created: 1,
        hidden: false,
        mime: 'model/gltf-binary',
        identity: 'model',
      },
    },
    active: true,
    interactive: true,
    look: 'dark',
    signal: new AbortController().signal,
    services: {} as PreviewContext['services'],
  };
  for (let cycle = 0; cycle < 3; cycle += 1) {
    const start = added.mock.calls.length;
    const view = render(<ModelPreview {...context} />);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control' }));
    const listeners = added.mock.calls
      .slice(start)
      .filter(
        ([name, , options]) =>
          ['keydown', 'keyup'].includes(name) && typeof options === 'object' && options?.capture,
      );
    expect(listeners).toHaveLength(2);
    view.unmount();
    try {
      for (const [name, listener] of listeners)
        expect(
          removed.mock.calls.some(
            ([event, callback, options]) =>
              event === name &&
              callback === listener &&
              typeof options === 'object' &&
              options?.capture,
          ),
        ).toBe(true);
    } finally {
      // A failing baseline test must release only its own captured listeners.
      for (const [name, listener] of listeners)
        document.removeEventListener(name, listener, { capture: true });
    }
  }
  expect(disposedWhileConnected).toEqual([true, true, true]);
});
