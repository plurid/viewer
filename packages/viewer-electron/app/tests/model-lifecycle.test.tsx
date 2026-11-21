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

it('reports a missing companion asset with a literal percent sign without throwing URIError', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const gltf = JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    buffers: [{ byteLength: 36, uri: '50%gray.bin' }],
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('.gltf'))
        return new Response(gltf, { status: 200, headers: { 'content-type': 'model/gltf+json' } });
      return new Response('Not Found', { status: 404 });
    }),
  );
  const context: PreviewContext = {
    resource: {
      id: 'model-percent',
      url: 'https://fixture.invalid/scene.gltf',
      entry: {
        path: '/fixture/scene.gltf',
        name: 'scene.gltf',
        parent: '/fixture',
        extension: 'gltf',
        kind: 'file',
        directory: false,
        size: gltf.length,
        modified: 1,
        created: 1,
        hidden: false,
        mime: 'model/gltf+json',
        identity: 'model-percent',
      },
    },
    active: true,
    interactive: true,
    look: 'dark',
    signal: new AbortController().signal,
    services: {} as PreviewContext['services'],
  };
  const view = render(<ModelPreview {...context} />);
  await vi.waitFor(() => {
    expect(view.container.textContent).toContain('50%gray.bin');
  });
});
