import type { Resource } from '../../../domain/contracts';
import { sourceVersion } from '../../../domain/files/inspection';
import { pathContains } from '../../../domain/files/paths';
import { hasRemoteLocationScheme } from '../../../domain/remote/location';
import type { CadMesh } from './cad-data';
import type { MeshResult } from './mesh-data';
import { onModelMemoryPressure } from './memory';

/** Geometry as the workers return it: typed arrays only, never Three.js or GPU objects. */
export type ParsedModel = { kind: 'cad'; meshes: CadMesh[] } | { kind: 'mesh'; data: MeshResult };

interface CachedModel {
  path: string;
  model: ParsedModel;
  bytes: number;
}

/** A parse that previews of one file version share until the last of them closes. */
interface SharedParse {
  path: string;
  users: number;
  stop: AbortController;
  result: Promise<ParsedModel>;
}

/**
 * The file version a parse belongs to. A link's entry describes the link rather than the file it
 * opens, and a derived rendition is not the file, so neither is remembered. A server file is not
 * either: its identity hashes the path and its time has whole seconds, so a rewrite within one
 * second at the same size would read as the same version.
 */
export function modelCacheKey(resource: Resource): string | undefined {
  const file = resource.entry;
  if (file.kind !== 'file' || !file.identity || resource.derivation) return;
  if (file.identity.startsWith('sftp.') || hasRemoteLocationScheme(file.path)) return;
  return JSON.stringify([file.path, sourceVersion(file)]);
}

/** Bytes of the distinct buffers, or undefined for anything but a complete worker result. */
export function parsedModelBytes(model: ParsedModel): number | undefined {
  const arrays =
    model.kind === 'cad'
      ? Array.isArray(model.meshes)
        ? model.meshes.flatMap((mesh) => [mesh.positions, mesh.indices, mesh.normals])
        : undefined
      : Array.isArray(model.data?.meshes)
        ? model.data.meshes.flatMap((mesh) => [
            ...Object.values(mesh.attributes).map((attribute) => attribute.array),
            mesh.index,
          ])
        : undefined;
  if (!arrays) return;
  const buffers = new Set<ArrayBufferLike>();
  for (const array of arrays) if (array) buffers.add(array.buffer);
  let bytes = 0;
  for (const buffer of buffers) bytes += buffer.byteLength;
  return bytes;
}

const aborted = () => new DOMException('Aborted', 'AbortError');

/**
 * Parsed models by file version, for this window only and in memory only. A preview builds and
 * disposes its own Three.js objects from these arrays; nothing here holds GPU memory. Reuse still
 * follows the preview's own authorized resource, and an access change forgets the folder.
 */
export class ModelGeometryCache {
  private entries = new Map<string, CachedModel>();
  private parses = new Map<string, SharedParse>();
  private bytes = 0;
  private changes = 0;
  private watching = false;

  constructor(
    private byteLimit = 512 * 1024 * 1024,
    private countLimit = 16,
  ) {}

  /** Numeric diagnostics only. */
  snapshot() {
    return { entries: this.entries.size, bytes: this.bytes, parsing: this.parses.size };
  }

  has(key: string | undefined): boolean {
    return !!key && this.entries.has(key);
  }

  get(key: string | undefined): ParsedModel | undefined {
    const cached = key ? this.entries.get(key) : undefined;
    if (!cached) return;
    this.entries.delete(key!);
    this.entries.set(key!, cached);
    return cached.model;
  }

  /** Marks the start of a parse: an access change before it ends keeps its result out. */
  begin(): number {
    this.watchAccess();
    return this.changes;
  }

  /**
   * Runs `parse` for this file version, or joins the one already running, so two previews of one
   * file, such as a plane and Quick Preview, convert it once. The parse stops when the last
   * preview waiting for it leaves.
   */
  share(
    key: string | undefined,
    path: string,
    parse: (signal: AbortSignal) => Promise<ParsedModel>,
    signal: AbortSignal,
  ): Promise<ParsedModel> {
    if (signal.aborted) return Promise.reject(aborted());
    if (!key) return parse(signal);
    // A preview whose file read ended after another preview's conversion takes its result.
    const cached = this.get(key);
    if (cached) return Promise.resolve(cached);
    let shared = this.parses.get(key);
    if (!shared) {
      const stop = new AbortController();
      const started: SharedParse = {
        path,
        users: 0,
        stop,
        result: parse(stop.signal),
      };
      const done = () => {
        if (this.parses.get(key) === started) this.parses.delete(key);
      };
      started.result.then(done, done);
      this.parses.set(key, started);
      shared = started;
    }
    const joined = shared;
    joined.users += 1;
    return new Promise((resolve, reject) => {
      let waiting = true;
      const leave = () => {
        if (!waiting) return;
        waiting = false;
        joined.users -= 1;
        if (!joined.users) {
          joined.stop.abort();
          if (this.parses.get(key) === joined) this.parses.delete(key);
        }
        reject(aborted());
      };
      signal.addEventListener('abort', leave, { once: true });
      const settle = () => {
        waiting = false;
        signal.removeEventListener('abort', leave);
      };
      joined.result.then(
        (model) => {
          if (!waiting) return;
          settle();
          resolve(model);
        },
        (error: unknown) => {
          if (!waiting) return;
          settle();
          reject(error);
        },
      );
    });
  }

  /**
   * Remembers a finished parse in place of the file's earlier versions; a larger set forgets the
   * least recently used first.
   */
  set(key: string | undefined, path: string, model: ParsedModel, begun: number): void {
    if (!key || begun !== this.changes) return;
    const bytes = parsedModelBytes(model);
    if (bytes === undefined || bytes > this.byteLimit || this.countLimit < 1) return;
    for (const [other, entry] of this.entries) if (entry.path === path) this.forget(other);
    this.entries.set(key, { path, model, bytes });
    this.bytes += bytes;
    // Bounded by the entries, so drifted accounting cannot keep it turning.
    for (let left = this.entries.size; left > 0; left -= 1) {
      if (this.entries.size <= this.countLimit && this.bytes <= this.byteLimit) break;
      this.forget(this.entries.keys().next().value!);
    }
  }

  /** Forgets every model inside `root`, or all of them; a running parse there is not reused. */
  invalidate(root?: string): void {
    this.changes += 1;
    for (const [key, entry] of this.entries)
      if (!root || pathContains(root, entry.path)) this.forget(key);
    for (const [key, parse] of this.parses)
      if (!root || pathContains(root, parse.path)) this.parses.delete(key);
    if (!this.entries.size) this.bytes = 0;
  }

  clear(): void {
    this.invalidate();
  }

  private forget(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
  }

  private watchAccess(): void {
    if (this.watching || typeof window === 'undefined' || !window.viewer?.onEvent) return;
    this.watching = true;
    window.viewer.onEvent((event) => {
      if (event.type === 'file-access') this.invalidate(event.path);
    });
  }
}

export const modelGeometryCache = new ModelGeometryCache();
onModelMemoryPressure(() => modelGeometryCache.clear());
