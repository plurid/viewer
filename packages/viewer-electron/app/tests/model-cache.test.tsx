// @vitest-environment jsdom
import * as THREE from 'three';
import type * as ThreeModule from 'three';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ModelPreview from '../src/renderer/previews/modules/ModelPreview';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import type { FileEntry, Resource } from '../src/domain/contracts';
import type { CadMesh, CadResponse } from '../src/renderer/previews/model/cad-data';
import type { MeshResult } from '../src/renderer/previews/model/mesh-data';
import {
  ModelGeometryCache,
  modelCacheKey,
  modelGeometryCache,
  parsedModelBytes,
} from '../src/renderer/previews/model/cache';
import type { ParsedModel } from '../src/renderer/previews/model/cache';
import {
  cadObject,
  importCad,
  retainCadWorker,
  WarmCadWorker,
} from '../src/renderer/previews/model/cad';
import { importMesh } from '../src/renderer/previews/model/mesh';
import { assertModelMemory, releaseModelMemory } from '../src/renderer/previews/model/memory';
import type * as CadModule from '../src/renderer/previews/model/cad';
import type * as MeshModule from '../src/renderer/previews/model/mesh';

const graphics = vi.hoisted(() => ({
  camera: undefined as ThreeModule.PerspectiveCamera | undefined,
  frames: new Map<number, FrameRequestCallback>(),
  nextFrame: 0,
  release: vi.fn(),
}));

vi.mock('three', async (original) => ({
  ...(await original<typeof ThreeModule>()),
  WebGLRenderer: class {
    domElement = document.createElement('canvas');
    shadowMap = { enabled: false, type: 0 };
    setPixelRatio() {}
    setSize() {}
    render(_scene: ThreeModule.Scene, camera: ThreeModule.PerspectiveCamera) {
      graphics.camera = camera;
    }
    dispose() {}
    forceContextLoss() {}
  },
}));

vi.mock('../src/renderer/previews/model/mesh', async (original) => ({
  ...(await original<typeof MeshModule>()),
  importMesh: vi.fn(),
}));

vi.mock('../src/renderer/previews/model/cad', async (original) => ({
  ...(await original<typeof CadModule>()),
  importCad: vi.fn(),
  retainCadWorker: vi.fn(() => graphics.release),
}));

/** A closed box in the converter's shape: 8 corners, 12 triangles. */
function cadBox(): CadMesh[] {
  const geometry = new THREE.BoxGeometry(10, 20, 30).toNonIndexed();
  const positions = new Float32Array(geometry.getAttribute('position').array);
  return [
    {
      name: 'Part',
      color: [0.5, 0.5, 0.5],
      positions,
      indices: Uint32Array.from({ length: positions.length / 3 }, (_, index) => index),
    },
  ];
}

function meshBox(libraries: string[] = []): MeshResult {
  const geometry = new THREE.BoxGeometry(2, 4, 6);
  return {
    meshes: [
      {
        name: 'Box',
        kind: 'mesh',
        attributes: {
          position: {
            array: new Float32Array(geometry.getAttribute('position').array),
            itemSize: 3,
            normalized: false,
          },
          normal: {
            array: new Float32Array(geometry.getAttribute('normal').array),
            itemSize: 3,
            normalized: false,
          },
        },
        index: new Uint32Array(geometry.getIndex()!.array),
        groups: [],
        materials: [
          {
            name: 'surface',
            kind: 'standard',
            color: [1, 1, 1],
            opacity: 1,
            transparent: false,
            vertexColors: false,
            flatShading: false,
            side: THREE.DoubleSide,
          },
        ],
      },
    ],
    libraries,
  };
}

function entry(extension: string, changes: Partial<FileEntry> = {}): FileEntry {
  return {
    path: `/fixture/part.${extension}`,
    name: `part.${extension}`,
    parent: '/fixture',
    extension,
    kind: 'file',
    directory: false,
    size: 100,
    modified: 1,
    created: 1,
    hidden: false,
    mime: 'application/octet-stream',
    identity: `part-${extension}`,
    ...changes,
  };
}

let grants = 0;
function context(
  file: FileEntry,
  values = new Map<string, unknown>(),
  extra: Partial<PreviewContext> = {},
): PreviewContext {
  // Every mount is a new grant with its own resource ID and URL.
  grants += 1;
  return {
    resource: {
      id: `grant-${grants}`,
      url: `https://fixture.invalid/${grants}/${file.name}`,
      entry: file,
    },
    active: true,
    interactive: true,
    toolbar: 'all',
    state: {
      get: (key) => values.get(key),
      set: (key, value) => {
        values.set(key, value);
      },
    },
    look: 'dark',
    signal: new AbortController().signal,
    services: {} as PreviewContext['services'],
    ...extra,
  };
}

function frames(count = 1) {
  act(() => {
    for (let index = 0; index < count; index += 1) {
      const pending = [...graphics.frames.values()];
      graphics.frames.clear();
      for (const callback of pending) callback(performance.now());
    }
  });
}

const frameButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Frame model' });

async function open(file: FileEntry, values?: Map<string, unknown>) {
  const view = render(<ModelPreview {...context(file, values)} />);
  await waitFor(() => expect(frameButton().disabled).toBe(false));
  frames();
  return view;
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe() {
        this.callback([], this as unknown as ResizeObserver);
      }
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
      text: async () => 'mtllib part.mtl\n',
    })),
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++graphics.nextFrame;
    graphics.frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    graphics.frames.delete(id);
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 800, 600),
  );
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  HTMLCanvasElement.prototype.releasePointerCapture = vi.fn();
  HTMLCanvasElement.prototype.hasPointerCapture = () => true;
  vi.mocked(importCad).mockImplementation(async () => cadBox());
  vi.mocked(importMesh).mockImplementation(async (source) =>
    meshBox(typeof source === 'string' ? ['part.mtl'] : []),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  graphics.frames.clear();
  graphics.camera = undefined;
  graphics.release.mockClear();
  modelGeometryCache.clear();
});

describe('a model opened again', () => {
  it('shows a remembered STEP at once with its camera, without fetching or converting', async () => {
    const values = new Map<string, unknown>();
    const first = await open(entry('step'), values);
    expect(importCad).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
    const saved = {
      position: [40, -50, 60],
      target: [1, 2, 3],
      up: [0, 0.6, 0.8],
      rotation: 'free',
    };
    values.set('model.camera', saved);
    first.unmount();
    render(<ModelPreview {...context(entry('step'), values)} />);
    // No waiting: the first paint already has the model and its remembered camera.
    expect(screen.queryByText('Loading model…')).toBeNull();
    expect(frameButton().disabled).toBe(false);
    frames();
    expect(graphics.camera!.position.toArray()).toEqual(saved.position);
    expect(graphics.camera!.up.toArray()).toEqual(saved.up);
    expect(importCad).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
    expect(screen.getByText(/1 mesh · 12 triangles · 36 vertices/)).toBeTruthy();
  });

  it.each([
    ['size', { size: 101 }],
    ['modified time', { modified: 2 }],
    ['identity', { identity: 'replaced' }],
  ])('converts again when the file’s %s changes', async (_change, changes) => {
    (await open(entry('step'))).unmount();
    (await open(entry('step', changes))).unmount();
    expect(importCad).toHaveBeenCalledTimes(2);
  });

  it('parses STL, PLY and OFF once per version, and reads only an OBJ’s material library again', async () => {
    for (const extension of ['stl', 'ply', 'off']) {
      (await open(entry(extension))).unmount();
      (await open(entry(extension))).unmount();
    }
    expect(importMesh).toHaveBeenCalledTimes(3);
    (await open(entry('obj'))).unmount();
    expect(importMesh).toHaveBeenCalledTimes(4);
    const fetches = vi.mocked(fetch).mock.calls.length;
    (await open(entry('obj'))).unmount();
    expect(importMesh).toHaveBeenCalledTimes(4);
    const again = vi
      .mocked(fetch)
      .mock.calls.slice(fetches)
      .map(([url]) => String(url));
    expect(again).toHaveLength(1);
    expect(again[0]).toMatch(/\/part\.mtl$/);
  });

  it('keeps the arrays and gives each preview its own GPU geometry, disposed on close', async () => {
    const converted = new Set<unknown>();
    vi.mocked(importCad).mockImplementation(async () => {
      const meshes = cadBox();
      for (const mesh of meshes) converted.add(mesh.positions);
      return meshes;
    });
    const built: THREE.BufferGeometry[] = [];
    const setAttribute = THREE.BufferGeometry.prototype.setAttribute;
    vi.spyOn(THREE.BufferGeometry.prototype, 'setAttribute').mockImplementation(function (
      this: THREE.BufferGeometry,
      name,
      attribute,
    ) {
      if (name === 'position' && converted.has(attribute.array)) built.push(this);
      return setAttribute.call(this, name, attribute);
    });
    const dispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const first = await open(entry('step'));
    const arrays = (await vi.mocked(importCad).mock.results[0]!.value) as CadMesh[];
    expect(built).toHaveLength(1);
    first.unmount();
    expect(dispose.mock.contexts).toContain(built[0]);
    const second = await open(entry('step'));
    expect(built).toHaveLength(2);
    expect(built[1]).not.toBe(built[0]);
    expect(built[1]!.getAttribute('position').array).toBe(arrays[0]!.positions);
    second.unmount();
    expect(dispose.mock.contexts).toContain(built[1]);
    expect(arrays[0]!.positions.byteLength).toBe(108 * 4);
    expect(modelGeometryCache.snapshot().entries).toBe(1);
  });

  it('explains truncated STL data and sends the parser detail only to diagnostics', async () => {
    const diagnosticReport = vi.fn(async () => {});
    const original = window.viewer;
    Object.assign(window, { viewer: { ...original, diagnosticReport } });
    try {
      const detail = 'Offset is outside the bounds of the DataView';
      vi.mocked(importMesh).mockRejectedValueOnce(new Error(detail));
      const preview = render(<ModelPreview {...context(entry('stl'))} />);
      await screen.findByText('The file ends before all of its model data can be read.');
      expect(preview.queryByText(detail)).toBeNull();
      expect(diagnosticReport).toHaveBeenCalledWith(
        expect.objectContaining({ detail: expect.stringContaining(detail) }),
      );
    } finally {
      Object.assign(window, { viewer: original });
    }
  });

  it('remembers no failed, cancelled or unshowable parse', async () => {
    vi.mocked(importCad).mockRejectedValueOnce(new Error('No geometry could be read.'));
    const failed = render(<ModelPreview {...context(entry('step'))} />);
    await screen.findByText('No geometry could be read.');
    failed.unmount();
    vi.mocked(importCad).mockImplementationOnce(
      (_buffer, _extension, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
        ),
    );
    const cancelled = render(<ModelPreview {...context(entry('step'))} />);
    await waitFor(() => expect(importCad).toHaveBeenCalledTimes(2));
    cancelled.unmount();
    vi.mocked(importCad).mockResolvedValueOnce([
      {
        name: 'Invalid',
        positions: new Float32Array([NaN, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      },
    ]);
    const flat = render(<ModelPreview {...context(entry('step'))} />);
    await screen.findByText("Can't show this model");
    flat.unmount();
    expect(modelGeometryCache.snapshot().entries).toBe(0);
    (await open(entry('step'))).unmount();
    expect(importCad).toHaveBeenCalledTimes(4);
  });

  it('keeps the CAD worker for every open 3D preview', async () => {
    const view = await open(entry('obj'));
    expect(retainCadWorker).toHaveBeenCalledOnce();
    expect(graphics.release).not.toHaveBeenCalled();
    view.unmount();
    expect(graphics.release).toHaveBeenCalledOnce();
  });
});

describe('the geometry cache', () => {
  const model = (bytes: number): ParsedModel => ({
    kind: 'cad',
    meshes: [
      {
        name: 'part',
        positions: new Float32Array(bytes / 8),
        indices: new Uint32Array(bytes / 8),
      },
    ],
  });

  it('keys a version of a plain file, never a link or a derived rendition', () => {
    const resource = (file: FileEntry, derived = false): Resource => ({
      id: 'grant',
      url: 'viewer-resource://grant',
      entry: file,
      ...(derived
        ? { derivation: { kind: 'raw', decoder: 'test' } satisfies Resource['derivation'] }
        : {}),
    });
    const key = modelCacheKey(resource(entry('step')));
    expect(key).toBeTruthy();
    expect(modelCacheKey({ ...resource(entry('step')), id: 'other', url: 'other' })).toBe(key);
    expect(modelCacheKey(resource(entry('step', { path: '/elsewhere/part.step' })))).not.toBe(key);
    expect(modelCacheKey(resource(entry('step', { kind: 'symlink' })))).toBeUndefined();
    expect(modelCacheKey(resource(entry('step', { identity: '' })))).toBeUndefined();
    expect(modelCacheKey(resource(entry('step'), true))).toBeUndefined();
  });

  it('forgets the least recently used model past its count or byte limit', () => {
    const cache = new ModelGeometryCache(1000, 3);
    const begun = cache.begin();
    for (const name of ['a', 'b', 'c']) cache.set(name, `/f/${name}`, model(160), begun);
    expect(cache.get('a')).toBeTruthy();
    cache.set('d', '/f/d', model(160), begun);
    expect(cache.has('b')).toBe(false);
    expect(['a', 'c', 'd'].every((name) => cache.has(name))).toBe(true);
    cache.set('e', '/f/e', model(760), begun);
    expect(cache.snapshot()).toEqual({ entries: 2, bytes: 920, parsing: 0 });
    expect(cache.has('a')).toBe(false);
    expect(cache.has('c')).toBe(false);
    cache.set('huge', '/f/huge', model(1200), begun);
    expect(cache.has('huge')).toBe(false);
    expect(cache.snapshot().entries).toBe(2);
  });

  it('counts shared buffers once and refuses anything but a complete worker result', () => {
    const shared = new Float32Array(64);
    expect(
      parsedModelBytes({
        kind: 'cad',
        meshes: [
          { name: 'a', positions: shared, indices: new Uint32Array(shared.buffer) },
          { name: 'b', positions: shared, indices: new Uint32Array(8) },
        ],
      }),
    ).toBe(256 + 32);
    expect(
      parsedModelBytes({ kind: 'mesh', data: undefined as unknown as MeshResult }),
    ).toBeUndefined();
    const cache = new ModelGeometryCache();
    cache.set(
      'x',
      '/f/x',
      { kind: 'mesh', data: undefined as unknown as MeshResult },
      cache.begin(),
    );
    expect(cache.has('x')).toBe(false);
  });

  it('forgets a folder whose access changes, including a parse that was running', () => {
    let listener: ((event: { type: string; path: string }) => void) | undefined;
    vi.stubGlobal('viewer', {
      onEvent: (next: typeof listener) => {
        listener = next;
        return () => {};
      },
    });
    const cache = new ModelGeometryCache();
    const begun = cache.begin();
    cache.set('in', '/Volumes/Work/in.step', model(80), begun);
    cache.set('out', '/Users/me/out.step', model(80), begun);
    const running = cache.begin();
    listener!({ type: 'file-access', path: '/Volumes/Work' });
    expect(cache.has('in')).toBe(false);
    expect(cache.has('out')).toBe(true);
    cache.set('late', '/Users/me/late.step', model(80), running);
    expect(cache.has('late')).toBe(false);
  });

  it('empties when a model runs out of memory', () => {
    modelGeometryCache.set('x', '/f/x', model(80), modelGeometryCache.begin());
    expect(modelGeometryCache.snapshot().entries).toBe(1);
    releaseModelMemory();
    expect(modelGeometryCache.snapshot().entries).toBe(0);
  });
});

describe('the warm CAD worker', () => {
  class FakeWorker {
    onmessage: ((event: MessageEvent<CadResponse>) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onmessageerror: ((event: Event) => void) | null = null;
    posted: { id: number; extension: string; buffer: ArrayBuffer; module?: unknown }[] = [];
    terminated = false;
    postMessage(request: { id: number; extension: string; buffer: ArrayBuffer }) {
      this.posted.push(request);
    }
    terminate() {
      this.terminated = true;
    }
    reply(changes: Partial<CadResponse> = {}) {
      const request = this.posted.at(-1)!;
      this.onmessage?.({
        data: { id: request.id, meshes: cadBox(), ...changes },
      } as MessageEvent<CadResponse>);
    }
  }
  const workers: FakeWorker[] = [];
  const converters: WarmCadWorker[] = [];
  const compiled = { compiled: 'OCCT' } as unknown as WebAssembly.Module;
  const compile = vi.fn(async () => compiled);
  function converter(options: Partial<ConstructorParameters<typeof WarmCadWorker>[0]> = {}) {
    const created = new WarmCadWorker({
      create: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      },
      compile,
      ...options,
    });
    converters.push(created);
    return created;
  }
  const signal = () => new AbortController().signal;
  /** The module promise settles before a request is posted. */
  const posted = () => vi.advanceTimersByTimeAsync(0);

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    for (const created of converters) created.dispose();
    converters.length = 0;
    workers.length = 0;
  });

  it('converts in one worker, keeps it two minutes after the last preview, then stops it', async () => {
    const cad = converter();
    const close = cad.retain();
    const first = cad.request(new ArrayBuffer(8), 'step', signal());
    await posted();
    workers[0]!.reply();
    await expect(first).resolves.toHaveLength(1);
    const second = cad.request(new ArrayBuffer(8), 'iges', signal());
    await posted();
    workers[0]!.reply();
    await second;
    expect(workers).toHaveLength(1);
    expect(workers[0]!.posted.map((request) => request.extension)).toEqual(['step', 'iges']);
    vi.advanceTimersByTime(300_000);
    expect(cad.warm).toBe(true);
    close();
    close();
    vi.advanceTimersByTime(119_999);
    expect(workers[0]!.terminated).toBe(false);
    // A preview opened in time keeps OCCT loaded.
    const reopened = cad.retain();
    vi.advanceTimersByTime(60_000);
    expect(workers[0]!.terminated).toBe(false);
    reopened();
    vi.advanceTimersByTime(120_000);
    expect(workers[0]!.terminated).toBe(true);
    expect(cad.warm).toBe(false);
    const later = cad.request(new ArrayBuffer(8), 'step', signal());
    await posted();
    expect(workers).toHaveLength(2);
    workers[1]!.reply();
    await later;
  });

  it('compiles OCCT once and hands it to every worker, also after a cancelled conversion', async () => {
    const cad = converter();
    const abort = new AbortController();
    const cancelled = cad.request(new ArrayBuffer(8), 'step', abort.signal);
    await posted();
    abort.abort();
    await expect(cancelled).rejects.toThrow('Aborted');
    const next = cad.request(new ArrayBuffer(8), 'step', signal());
    await posted();
    workers[1]!.reply();
    await next;
    expect(compile).toHaveBeenCalledOnce();
    expect(workers.map((worker) => worker.posted[0]!.module)).toEqual([compiled, compiled]);
  });

  it('stops a worker whose OCCT heap passed the limit, and under memory pressure', async () => {
    const cad = converter({ heapLimit: 1000 });
    cad.retain();
    const small = cad.request(new ArrayBuffer(8), 'step', signal());
    await posted();
    workers[0]!.reply({ heap: 1000 });
    await small;
    expect(workers[0]!.terminated).toBe(false);
    const large = cad.request(new ArrayBuffer(8), 'step', signal());
    await posted();
    workers[0]!.reply({ heap: 1001 });
    await large;
    expect(workers[0]!.terminated).toBe(true);
    const busy = cad.request(new ArrayBuffer(8), 'step', signal());
    await posted();
    releaseModelMemory();
    expect(workers[1]!.terminated).toBe(false);
    workers[1]!.reply();
    await expect(busy).resolves.toHaveLength(1);
    expect(workers[1]!.terminated).toBe(true);
  });

  it('stops a cancelled conversion so the next file starts at once, ignoring a late reply', async () => {
    const cad = converter();
    const abort = new AbortController();
    const cancelled = cad.request(new ArrayBuffer(8), 'step', abort.signal);
    const queued = cad.request(new ArrayBuffer(8), 'iges', signal());
    await posted();
    abort.abort();
    await expect(cancelled).rejects.toThrow('Aborted');
    expect(workers[0]!.terminated).toBe(true);
    await posted();
    expect(workers[1]!.posted.map((request) => request.extension)).toEqual(['iges']);
    workers[0]!.reply();
    // A reply for another request is not this one's.
    workers[1]!.reply({ id: 999 });
    let settled = false;
    void queued.then(() => (settled = true));
    await posted();
    expect(settled).toBe(false);
    workers[1]!.reply();
    await expect(queued).resolves.toHaveLength(1);
  });

  it('gives up on a conversion past its time, and on a worker that fails, then goes on', async () => {
    const cad = converter({ conversionMilliseconds: 45_000 });
    const slow = cad.request(new ArrayBuffer(8), 'step', signal());
    await posted();
    vi.advanceTimersByTime(44_999);
    expect(workers[0]!.terminated).toBe(false);
    vi.advanceTimersByTime(1);
    await expect(slow).rejects.toThrow('CAD conversion took too long');
    expect(workers[0]!.terminated).toBe(true);
    const broken = cad.request(new ArrayBuffer(8), 'step', signal());
    const next = cad.request(new ArrayBuffer(8), 'iges', signal());
    await posted();
    const error = new Event('error', { cancelable: true });
    workers[1]!.onerror!(error);
    expect(error.defaultPrevented).toBe(true);
    await expect(broken).rejects.toThrow('stopped while reading this file');
    expect(workers[1]!.terminated).toBe(true);
    await posted();
    workers[2]!.reply();
    await expect(next).resolves.toHaveLength(1);
  });

  it('gives up on a compile that never ends within the conversion time, then compiles in the worker', async () => {
    const hung = vi.fn(() => new Promise<WebAssembly.Module | undefined>(() => {}));
    const cad = converter({ compile: hung });
    const stuck = cad.request(new ArrayBuffer(8), 'step', signal());
    await posted();
    expect(workers).toHaveLength(0);
    vi.advanceTimersByTime(45_000);
    await expect(stuck).rejects.toThrow('CAD conversion took too long');
    const next = cad.request(new ArrayBuffer(8), 'step', signal());
    await posted();
    expect(workers[0]!.posted[0]!.module).toBeUndefined();
    workers[0]!.reply();
    await expect(next).resolves.toHaveLength(1);
    expect(hung).toHaveBeenCalledOnce();
  });

  it('cancels a conversion waiting for the compile and posts only the next one', async () => {
    let finish!: (module: WebAssembly.Module) => void;
    const cad = converter({
      compile: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const abort = new AbortController();
    const waiting = cad.request(new ArrayBuffer(8), 'step', abort.signal);
    const next = cad.request(new ArrayBuffer(8), 'iges', signal());
    abort.abort();
    await expect(waiting).rejects.toThrow('Aborted');
    finish(compiled);
    await posted();
    expect(workers).toHaveLength(1);
    expect(workers[0]!.posted.map((request) => request.extension)).toEqual(['iges']);
    workers[0]!.reply();
    await next;
  });

  it('lets go of the compiled module after its idle time and under memory pressure', async () => {
    const cad = converter();
    const close = cad.retain();
    const first = cad.request(new ArrayBuffer(8), 'step', signal());
    await posted();
    workers[0]!.reply();
    await first;
    close();
    vi.advanceTimersByTime(120_000);
    const second = cad.request(new ArrayBuffer(8), 'step', signal());
    await posted();
    workers[1]!.reply();
    await second;
    expect(compile).toHaveBeenCalledTimes(2);
    releaseModelMemory();
    expect(workers[1]!.terminated).toBe(true);
    const third = cad.request(new ArrayBuffer(8), 'step', signal());
    await posted();
    workers[2]!.reply();
    await third;
    expect(compile).toHaveBeenCalledTimes(3);
  });

  it('lets go after a conversion that memory pressure met while it waited for the compile', async () => {
    let finish!: (module: WebAssembly.Module) => void;
    const cad = converter({
      compile: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    cad.retain();
    const waiting = cad.request(new ArrayBuffer(8), 'step', signal());
    releaseModelMemory();
    finish(compiled);
    await posted();
    workers[0]!.reply();
    await waiting;
    expect(workers[0]!.terminated).toBe(true);
  });

  it('stops listening for memory pressure once disposed', async () => {
    const cad = converter();
    cad.retain();
    cad.dispose();
    const after = cad.request(new ArrayBuffer(8), 'step', signal());
    await posted();
    releaseModelMemory();
    workers[0]!.reply();
    await after;
    expect(workers[0]!.terminated).toBe(false);
  });
});

describe('remembered models and the preview around them', () => {
  it('keeps a remembered Turntable camera on an instant reopen, saving nothing', async () => {
    const values = new Map<string, unknown>();
    const first = await open(entry('step'), values);
    fireEvent.click(screen.getByRole('button', { name: /^Rotation\b/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Turntable' }));
    const saved = {
      position: [30, -40, 25],
      target: [0, 0, 0],
      up: [0, 0, 1],
      rotation: 'turntable',
    };
    values.set('model.camera', saved);
    first.unmount();
    const writes: string[] = [];
    const tracked = new Map(values);
    const set = tracked.set.bind(tracked);
    tracked.set = (key: string, value: unknown) => {
      writes.push(key);
      return set(key, value);
    };
    render(<ModelPreview {...context(entry('step'), tracked)} />);
    frames();
    expect(screen.getByRole('button', { name: /^Rotation\b/ }).textContent).toContain('Turntable');
    graphics
      .camera!.position.toArray()
      .forEach((value, index) => expect(value).toBeCloseTo(saved.position[index]!, 9));
    expect(writes).toEqual([]);
  });

  it('restores a measurement, places an evidence anchor and survives StrictMode on an instant reopen', async () => {
    const values = new Map<string, unknown>();
    (await open(entry('step'), values)).unmount();
    values.set('model.measure', true);
    values.set('model.measurement', [
      [-5, -10, -15],
      [5, -10, -15],
    ]);
    const measured = render(<ModelPreview {...context(entry('step'), values)} />);
    frames();
    expect(screen.getByRole('status').textContent).toMatch(/Distance: 10 mm/);
    measured.unmount();
    const evidence = {
      path: '/fixture/part.step',
      version: { identity: 'part-step', modified: 1, size: 100 },
      anchor: { kind: 'model', position: [0, -90, 0], target: [1, 2, 3] },
      quote: '',
    } as unknown as PreviewContext['evidence'];
    const anchored = render(<ModelPreview {...context(entry('step'), undefined, { evidence })} />);
    frames();
    expect(graphics.camera!.position.toArray()).toEqual([0, -90, 0]);
    anchored.unmount();
    const strict = render(
      <StrictMode>
        <ModelPreview {...context(entry('step'))} />
      </StrictMode>,
    );
    frames();
    expect(strict.container.querySelectorAll('canvas')).toHaveLength(1);
    expect(screen.getByText(/1 mesh · 12 triangles · 36 vertices/)).toBeTruthy();
    expect(importCad).toHaveBeenCalledOnce();
  });

  it('applies the file limit in Settings to a remembered model too', async () => {
    const large = entry('step', { size: 20_000_000 });
    (await open(large)).unmount();
    expect(modelGeometryCache.snapshot().entries).toBe(1);
    render(
      <ModelPreview
        {...context(large, undefined, { limits: { maxImagePixels: 1, maxModelMB: 16 } })}
      />,
    );
    expect(screen.getByText('This model exceeds the file limit in Settings.')).toBeTruthy();
  });

  it('converts once when two previews of one file open together, and once more after both leave', async () => {
    let finish!: (meshes: CadMesh[]) => void;
    vi.mocked(importCad).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const plane = render(<ModelPreview {...context(entry('step'))} />);
    const quick = render(<ModelPreview {...context(entry('step'))} />);
    await waitFor(() => expect(importCad).toHaveBeenCalled());
    await act(async () => {
      finish(cadBox());
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getAllByText(/1 mesh · 12 triangles/)).toHaveLength(2));
    expect(importCad).toHaveBeenCalledOnce();
    plane.unmount();
    quick.unmount();
    modelGeometryCache.clear();
    let stopped: AbortSignal | undefined;
    vi.mocked(importCad).mockImplementation(
      (_buffer, _extension, signal) =>
        new Promise((_resolve, reject) => {
          stopped = signal;
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const first = render(<ModelPreview {...context(entry('step'))} />);
    const second = render(<ModelPreview {...context(entry('step'))} />);
    await waitFor(() => expect(importCad).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(modelGeometryCache.snapshot().parsing).toBe(1));
    first.unmount();
    expect(stopped!.aborted).toBe(false);
    second.unmount();
    expect(stopped!.aborted).toBe(true);
    expect(modelGeometryCache.snapshot()).toMatchObject({ entries: 0, parsing: 0 });
  });

  it('converts once when a second preview finishes reading after the first conversion', async () => {
    let release!: () => void;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        reads += 1;
        if (reads === 2) await slow;
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(8), text: async () => '' };
      }),
    );
    render(<ModelPreview {...context(entry('step'))} />);
    render(<ModelPreview {...context(entry('step'))} />);
    await waitFor(() => expect(modelGeometryCache.snapshot().entries).toBe(1));
    await act(async () => release());
    await waitFor(() => expect(screen.getAllByText(/1 mesh · 12 triangles/)).toHaveLength(2));
    expect(importCad).toHaveBeenCalledOnce();
  });

  it('keeps one version of a file: a newer one replaces the older', async () => {
    (await open(entry('step', { modified: 1 }))).unmount();
    (await open(entry('step', { modified: 2 }))).unmount();
    (await open(entry('step', { modified: 3 }))).unmount();
    (await open(entry('stl'))).unmount();
    expect(modelGeometryCache.snapshot().entries).toBe(2);
  });

  it('keeps the normals it computed for CAD meshes without them', () => {
    const meshes = cadBox();
    expect(meshes[0]!.normals).toBeUndefined();
    const group = cadObject(meshes);
    const normals = (group.children[0] as THREE.Mesh).geometry.getAttribute('normal').array;
    expect(meshes[0]!.normals).toBe(normals);
    const again = cadObject(meshes);
    expect((again.children[0] as THREE.Mesh).geometry.getAttribute('normal').array).toBe(normals);
    expect(parsedModelBytes({ kind: 'cad', meshes })).toBe(108 * 4 * 2 + 36 * 4);
  });
});

describe('the geometry cache keeps its accounts', () => {
  it('gives a late joiner the model already kept, without parsing again', async () => {
    const cache = new ModelGeometryCache();
    const model: ParsedModel = { kind: 'cad', meshes: cadBox() };
    cache.set('k', '/f/k', model, cache.begin());
    const parse = vi.fn(async () => model);
    await expect(cache.share('k', '/f/k', parse, new AbortController().signal)).resolves.toBe(
      model,
    );
    expect(parse).not.toHaveBeenCalled();
  });

  it('starts its byte count again from nothing once everything is forgotten', () => {
    const cache = new ModelGeometryCache();
    cache.set('k', '/f/k', { kind: 'cad', meshes: cadBox() }, cache.begin());
    (cache as unknown as { bytes: number }).bytes += 12345;
    cache.invalidate('/f');
    expect(cache.snapshot()).toMatchObject({ entries: 0, bytes: 0 });
  });

  it('starts a new parse after an access change, instead of joining the one running', async () => {
    const cache = new ModelGeometryCache();
    const parse = vi.fn(() => new Promise<ParsedModel>(() => {}));
    void cache.share('k', '/Volumes/Work/part.step', parse, new AbortController().signal);
    void cache.share('k', '/Volumes/Work/part.step', parse, new AbortController().signal);
    expect(parse).toHaveBeenCalledOnce();
    cache.invalidate('/Volumes/Work');
    void cache.share('k', '/Volumes/Work/part.step', parse, new AbortController().signal);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('counts mesh indices and CAD normals', () => {
    const mesh = meshBox();
    const index = mesh.meshes[0]!.index!.byteLength;
    const withIndex = parsedModelBytes({ kind: 'mesh', data: mesh })!;
    delete mesh.meshes[0]!.index;
    expect(withIndex - parsedModelBytes({ kind: 'mesh', data: mesh })!).toBe(index);
    const [part] = cadBox();
    const plain = parsedModelBytes({ kind: 'cad', meshes: [part!] })!;
    part!.normals = new Float32Array(30);
    expect(parsedModelBytes({ kind: 'cad', meshes: [part!] })).toBe(plain + 120);
  });

  it('never caches a server file, whose version cannot be told within a second', () => {
    const resource = (file: FileEntry): Resource => ({ id: 'grant', url: 'u', entry: file });
    expect(
      modelCacheKey(resource(entry('step', { identity: 'sftp.c1:file:abc' }))),
    ).toBeUndefined();
    expect(
      modelCacheKey(resource(entry('step', { path: 'viewer-sftp://c1/home/me/part.step' }))),
    ).toBeUndefined();
  });

  it('stops forgetting once it has forgotten every entry, even when its count drifted', () => {
    const cache = new ModelGeometryCache(1000, 3);
    (cache as unknown as { bytes: number }).bytes = 1e12;
    const begun = cache.begin();
    cache.set('a', '/f/a', { kind: 'cad', meshes: cadBox() }, begun);
    expect(cache.snapshot().entries).toBe(0);
  });

  it('releases remembered models when a model exceeds its decoded geometry or textures', () => {
    const remember = () =>
      modelGeometryCache.set(
        'k',
        '/f/k',
        { kind: 'cad', meshes: cadBox() },
        modelGeometryCache.begin(),
      );
    const object = cadObject(cadBox());
    remember();
    expect(() => assertModelMemory(object, 100)).toThrow('decoded geometry limit');
    expect(modelGeometryCache.snapshot().entries).toBe(0);
    remember();
    expect(() => assertModelMemory(object, 1e9)).not.toThrow();
    expect(modelGeometryCache.snapshot().entries).toBe(1);
  });
});
