// @vitest-environment jsdom
import type * as ThreeModule from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import ModelPreview from '../src/renderer/previews/modules/ModelPreview';
import type { PreviewContext } from '../src/renderer/previews/contracts';

const disposedWhileConnected = vi.hoisted(() => [] as boolean[]);
vi.mock('three', async (original) => ({
  ...(await original<typeof ThreeModule>()),
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

it.each(['glb', 'stl'])(
  'releases %s control listeners before React detaches a model canvas',
  (extension) => {
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
    const root = extension === 'stl' ? window : document;
    const capture = extension !== 'stl';
    const added = vi.spyOn(root, 'addEventListener');
    const removed = vi.spyOn(root, 'removeEventListener');
    const context: PreviewContext = {
      resource: {
        id: 'model',
        url: `https://fixture.invalid/model.${extension}`,
        entry: {
          path: '/fixture/model.glb',
          name: 'model.glb',
          parent: '/fixture',
          extension,
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
      root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control' }));
      const listeners = added.mock.calls
        .slice(start)
        .filter(
          ([name, , options]) =>
            ['keydown', 'keyup'].includes(name) &&
            (capture ? typeof options === 'object' && options?.capture : !options),
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
                (capture ? typeof options === 'object' && options?.capture : !options),
            ),
          ).toBe(true);
      } finally {
        // A failing baseline test must release only its own captured listeners.
        for (const [name, listener] of listeners)
          root.removeEventListener(name, listener, { capture });
      }
    }
    expect(disposedWhileConnected).toEqual([true, true, true]);
  },
);
