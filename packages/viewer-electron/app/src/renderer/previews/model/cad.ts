import { restoreReaderError } from '../../../domain/previews/reader-problem';
import * as THREE from 'three';
import wasmURL from 'occt-import-js/dist/occt-import-js.wasm?url';
import { cadMaterial } from './appearance';
import type { CadMesh, CadRequest, CadResponse } from './cad-data';
import { onModelMemoryPressure } from './memory';

interface Conversion {
  request: CadRequest;
  finish(error?: Error, meshes?: CadMesh[]): void;
}

const conversionLimit = 64_000_000;

function cadWorker(): Worker {
  return new Worker(new URL('./cad.worker.ts', import.meta.url), { type: 'module' });
}

/** OCCT compiled once per window. A worker without it compiles its own, as it did before. */
async function compileOcct(): Promise<WebAssembly.Module | undefined> {
  if (typeof WebAssembly === 'undefined') return;
  try {
    return await WebAssembly.compileStreaming(fetch(wasmURL));
  } catch {
    // compileStreaming needs the application/wasm type, which a served file may not carry.
    try {
      const response = await fetch(wasmURL);
      return response.ok ? await WebAssembly.compile(await response.arrayBuffer()) : undefined;
    } catch {
      return undefined;
    }
  }
}

export interface WarmCadWorkerOptions {
  create?(): Worker;
  compile?(): Promise<WebAssembly.Module | undefined>;
  idleMilliseconds?: number;
  conversionMilliseconds?: number;
  /** OCCT's heap only grows: a worker past this many bytes stops once it is idle. */
  heapLimit?: number;
}

/**
 * One OCCT worker converts files in turn and stays warm between previews, so its start-up runs
 * once. A cancelled conversion stops the worker: it never delays another preview, and the next
 * worker instantiates the module compiled for the first.
 */
export class WarmCadWorker {
  private worker?: Worker;
  private queue: Conversion[] = [];
  private current?: Conversion;
  private nextID = 0;
  private previews = 0;
  /** Stop when idle instead of waiting: past the heap limit or under memory pressure. */
  private cool = false;
  /** Memory pressure asked for the worker and the compiled module to go once idle. */
  private pressure = false;
  private module?: Promise<WebAssembly.Module | undefined>;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private conversionTimer?: ReturnType<typeof setTimeout>;
  private unsubscribe = onModelMemoryPressure(() => this.release());
  private create: () => Worker;
  private compile: () => Promise<WebAssembly.Module | undefined>;
  private idleMilliseconds: number;
  private conversionMilliseconds: number;
  private heapLimit: number;

  constructor(options: WarmCadWorkerOptions = {}) {
    this.create = options.create ?? cadWorker;
    this.compile = options.compile ?? compileOcct;
    this.idleMilliseconds = options.idleMilliseconds ?? 120_000;
    this.conversionMilliseconds = options.conversionMilliseconds ?? 45_000;
    this.heapLimit = options.heapLimit ?? 512 * 1024 * 1024;
  }

  /** Whether OCCT is loaded in a worker now. */
  get warm(): boolean {
    return !!this.worker;
  }

  /** An open 3D preview keeps the worker; the idle countdown starts when the last one closes. */
  retain(): () => void {
    this.previews += 1;
    clearTimeout(this.idleTimer);
    let retained = true;
    return () => {
      if (!retained) return;
      retained = false;
      this.previews -= 1;
      this.idle();
    };
  }

  request(buffer: ArrayBuffer, extension: string, signal: AbortSignal): Promise<CadMesh[]> {
    if (buffer.byteLength > conversionLimit)
      return Promise.reject(new Error('This CAD file exceeds the conversion limit (64 MB).'));
    if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    return new Promise((resolve, reject) => {
      let finished = false;
      const cancel = () => {
        if (this.current === job) this.stop();
        job.finish(new DOMException('Aborted', 'AbortError'));
      };
      const job: Conversion = {
        request: { id: ++this.nextID, buffer, extension },
        finish: (error, meshes) => {
          if (finished) return;
          finished = true;
          signal.removeEventListener('abort', cancel);
          this.queue = this.queue.filter((queued) => queued !== job);
          if (this.current === job) {
            clearTimeout(this.conversionTimer);
            this.current = undefined;
          }
          if (error) reject(error);
          else resolve(meshes!);
          this.pump();
        },
      };
      signal.addEventListener('abort', cancel, { once: true });
      this.queue.push(job);
      this.pump();
    });
  }

  private pump(): void {
    if (this.current) return;
    const job = this.queue.shift();
    if (!job) {
      this.idle();
      return;
    }
    clearTimeout(this.idleTimer);
    this.current = job;
    let compiling = true;
    // The conversion's time includes the window's compile. A compile that never ends is given
    // up, and later workers compile their own.
    this.conversionTimer = setTimeout(() => {
      if (compiling) this.module = Promise.resolve(undefined);
      this.stop();
      job.finish(
        new Error('CAD conversion took too long. Try a simpler model or reopen the file.'),
      );
    }, this.conversionMilliseconds);
    // Compiling waits once, for the first file; every later worker gets the module at once.
    this.module ??= this.compile().catch(() => undefined);
    void this.module.then((module) => {
      compiling = false;
      if (this.current === job) this.post(job, module);
    });
  }

  private post(job: Conversion, module: WebAssembly.Module | undefined): void {
    try {
      if (!this.worker) {
        this.worker = this.create();
        this.cool = this.pressure;
      }
      const worker = this.worker;
      worker.onmessage = (event: MessageEvent<CadResponse>) => {
        if (this.worker !== worker || this.current !== job || event.data.id !== job.request.id)
          return;
        if ((event.data.heap ?? 0) > this.heapLimit) this.cool = true;
        job.finish(
          event.data.error ? restoreReaderError(event.data.error, event.data) : undefined,
          event.data.meshes,
        );
      };
      const failed = (event?: Event) => {
        event?.preventDefault();
        if (this.worker !== worker) return;
        this.stop();
        job.finish(new Error('The CAD converter stopped while reading this file. Try again.'));
      };
      worker.onerror = failed;
      worker.onmessageerror = failed;
      worker.postMessage({ ...job.request, module } satisfies CadRequest, [job.request.buffer]);
    } catch (error) {
      this.stop();
      job.finish(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private idle(): void {
    clearTimeout(this.idleTimer);
    if (!this.worker || this.current || this.queue.length) return;
    if (this.cool) this.stop(this.pressure);
    else if (!this.previews)
      this.idleTimer = setTimeout(() => this.stop(true), this.idleMilliseconds);
  }

  /**
   * Stops the worker. A cancelled or failed conversion keeps the compiled module for the next
   * worker; the idle period and memory pressure `forget` it too.
   */
  private stop(forget = false): void {
    clearTimeout(this.idleTimer);
    clearTimeout(this.conversionTimer);
    this.worker?.terminate();
    this.worker = undefined;
    this.cool = false;
    if (forget) {
      this.module = undefined;
      this.pressure = false;
    }
  }

  /** Memory pressure: an idle converter lets go now, a busy one when its conversions end. */
  release(): void {
    this.pressure = true;
    if (this.worker || this.current) {
      this.cool = true;
      this.idle();
    } else this.stop(true);
  }

  dispose(): void {
    this.unsubscribe();
    const jobs = [...(this.current ? [this.current] : []), ...this.queue];
    this.stop();
    this.queue = [];
    for (const job of jobs) job.finish(new Error('The CAD converter stopped.'));
  }
}

const converter = new WarmCadWorker();

/** Keeps the CAD worker warm while a 3D preview is open; call the result on close. */
export const retainCadWorker = () => converter.retain();

export const importCad = (buffer: ArrayBuffer, extension: string, signal: AbortSignal) =>
  converter.request(buffer, extension, signal);

/**
 * Three.js meshes over the converter's arrays, which stay shared with the geometry cache.
 * Normals computed for a mesh without them are kept on it, for the next preview from the cache.
 */
export function cadObject(meshes: readonly CadMesh[]): THREE.Group {
  const group = new THREE.Group();
  for (const mesh of meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    if (mesh.normals) geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    else {
      geometry.computeVertexNormals();
      mesh.normals = geometry.getAttribute('normal').array as Float32Array;
    }
    const part = new THREE.Mesh(geometry, cadMaterial(mesh.color));
    part.name = mesh.name;
    group.add(part);
  }
  return group;
}
