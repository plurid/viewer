import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { lookup } from 'mime-types';
import { z } from 'zod';
import type { CanvasDocument, CanvasState, CanvasAsset } from '../../domain/canvases/document';
import {
  canvasAssetFile,
  canvasDocumentSchema,
  canvasLimits,
  canvasStateSchema,
  retainedCanvasState,
} from '../../domain/canvases/document';
import { DocumentStore } from '../persistence/document-store';
import { canvasHTML } from './runtime';

interface CanvasPorts {
  changed(owner: number, document: CanvasDocument): void;
  libraries?: () => ReadonlyMap<string, string>;
}

async function readBounded(file: string, limit: number): Promise<Buffer> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > limit)
      throw new Error('The canvas file is not a regular file within its size limit.');
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error('The canvas file changed while it was read.');
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new Error('The canvas file changed while it was read.');
    return bytes;
  } finally {
    await handle.close();
  }
}

export class Canvases {
  private stores = new Map<string, DocumentStore<CanvasDocument>>();
  private owners = new Map<string, number>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private root: string,
    private ports: CanvasPorts,
  ) {}

  private store(id: string) {
    z.uuid().parse(id);
    let store = this.stores.get(id);
    if (!store) {
      store = new DocumentStore(path.join(this.root, 'canvas-documents', id + '.json'), (value) =>
        canvasDocumentSchema.parse(value),
      );
      this.stores.set(id, store);
    }
    return store;
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const task = this.queue.catch(() => {}).then(work);
    this.queue = task;
    return task;
  }
  private async load(owner: number, id: string): Promise<CanvasDocument> {
    if (this.owners.has(id) && this.owners.get(id) !== owner)
      throw new Error('This canvas is open in another window.');
    const document = await this.store(id).load();
    if (!document) throw new Error('This canvas is unavailable.');
    this.owners.set(id, owner);
    return document;
  }
  read(owner: number, id: string): Promise<CanvasDocument> {
    return this.serial(() => this.load(owner, id));
  }
  private async save(owner: number, value: CanvasDocument): Promise<CanvasDocument> {
    const document = canvasDocumentSchema.parse(value);
    await this.store(document.id).save(document);
    this.owners.set(document.id, owner);
    this.ports.changed(owner, structuredClone(document));
    return document;
  }
  create(owner: number, conversationID: string, directory: string): Promise<CanvasDocument> {
    return this.serial(() =>
      this.save(owner, {
        version: 1,
        id: randomUUID(),
        conversationID,
        path: directory,
        title: 'Canvas',
        html: '<main style="font:16px system-ui;padding:24px"><h1>Your canvas</h1><p>Ask the agent to build a tool here.</p></main>',
        revision: 0,
        state: {},
        defaults: {},
        stateRevision: 0,
        assets: [],
        history: [],
        at: Date.now(),
      }),
    );
  }
  private revise(document: CanvasDocument, update: Partial<CanvasDocument>): CanvasDocument {
    const { revision, title, html, defaults, assets, at } = document;
    return {
      ...document,
      ...update,
      revision: revision + 1,
      at: Date.now(),
      history: [...document.history, { revision, title, html, defaults, assets, at }].slice(
        -canvasLimits.history,
      ),
    };
  }
  write(
    owner: number,
    id: string,
    expected: number,
    title: string,
    html: string,
    defaults: CanvasState,
  ): Promise<CanvasDocument> {
    return this.serial(async () => {
      const current = await this.load(owner, id);
      if (current.revision !== expected)
        throw new Error('This canvas changed. Read its current revision before updating it.');
      const state = retainedCanvasState(current.state, canvasStateSchema.parse(defaults));
      return this.save(
        owner,
        this.revise(current, {
          title,
          html,
          defaults,
          state,
          stateRevision: current.stateRevision + 1,
        }),
      );
    });
  }
  state(
    owner: number,
    id: string,
    expected: number,
    contentRevision: number,
    patch: CanvasState,
  ): Promise<CanvasDocument> {
    return this.serial(async () => {
      const current = await this.load(owner, id);
      if (current.revision !== contentRevision || current.stateRevision !== expected)
        throw new Error('This canvas changed. Reload its saved values before trying again.');
      return this.save(owner, {
        ...current,
        state: canvasStateSchema.parse({ ...current.state, ...canvasStateSchema.parse(patch) }),
        stateRevision: expected + 1,
      });
    });
  }
  fork(owner: number, id: string, conversationID: string): Promise<CanvasDocument> {
    return this.serial(async () => {
      const current = await this.load(owner, id);
      return this.save(owner, {
        ...current,
        id: randomUUID(),
        conversationID,
        history: [],
        revision: 0,
        stateRevision: 0,
        at: Date.now(),
        fork: { id, revision: current.revision },
      });
    });
  }
  apply(owner: number, id: string, expected: number): Promise<CanvasDocument> {
    return this.serial(async () => {
      const branch = await this.load(owner, id);
      if (!branch.fork || branch.revision !== expected)
        throw new Error('This alternative changed. Review its current revision.');
      const current = await this.load(owner, branch.fork.id);
      if (current.revision !== branch.fork.revision)
        throw new Error(
          'The original canvas has changed since this branch. Compare both canvases and ask the original chat to incorporate the selected changes.',
        );
      const state = retainedCanvasState(current.state, branch.defaults);
      return this.save(
        owner,
        this.revise(current, {
          html: branch.html,
          title: branch.title,
          defaults: branch.defaults,
          assets: branch.assets,
          state,
          stateRevision: current.stateRevision + 1,
        }),
      );
    });
  }
  undo(owner: number, id: string, expected: number): Promise<CanvasDocument> {
    return this.serial(async () => {
      const current = await this.load(owner, id);
      const previous = current.history.at(-1);
      if (current.revision !== expected || !previous)
        throw new Error('This revision can no longer be undone.');
      return this.save(owner, {
        ...current,
        ...previous,
        state: retainedCanvasState(current.state, previous.defaults),
        stateRevision: current.stateRevision + 1,
        revision: current.revision + 1,
        at: Date.now(),
        history: current.history.slice(0, -1),
      });
    });
  }
  async attachFile(owner: number, id: string, file: string): Promise<CanvasAsset> {
    const data = await readBounded(file, canvasLimits.assetBytes);
    return this.attach(owner, id, path.basename(file), data, file);
  }
  attach(
    owner: number,
    id: string,
    name: string,
    bytes: Uint8Array,
    source?: string,
    provenance?: string,
  ): Promise<CanvasAsset> {
    return this.serial(async () => {
      const document = await this.load(owner, id);
      if (bytes.length > canvasLimits.assetBytes)
        throw new Error('The canvas asset limit was reached.');
      const hash = createHash('sha256').update(bytes).digest('hex');
      const existing = document.assets.find((asset) => asset.hash === hash);
      if (existing) return existing;
      if (
        document.assets.length >= canvasLimits.assets ||
        document.assets.reduce((sum, asset) => sum + asset.bytes, bytes.length) >
          canvasLimits.totalAssetBytes
      )
        throw new Error('The canvas asset limit was reached.');
      const asset: CanvasAsset = {
        id: randomUUID(),
        name,
        mime: lookup(name) || 'application/octet-stream',
        bytes: bytes.length,
        hash,
        source,
        provenance,
      };
      const directory = path.join(this.root, 'canvas-assets');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const file = path.join(directory, hash);
      try {
        await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      const kept = await this.assetBytes(asset);
      if (kept.length !== bytes.length) throw new Error('The saved asset is unavailable.');
      await this.save(owner, this.revise(document, { assets: [...document.assets, asset] }));
      return asset;
    });
  }
  async assetBytes(asset: CanvasAsset): Promise<Buffer> {
    const bytes = await readBounded(path.join(this.root, 'canvas-assets', asset.hash), asset.bytes);
    if (
      bytes.length !== asset.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== asset.hash
    )
      throw new Error('The saved asset changed.');
    return bytes;
  }
  async files(document: CanvasDocument): Promise<Map<string, Uint8Array<ArrayBuffer>>> {
    const files = new Map<string, Uint8Array<ArrayBuffer>>([
      ['index.html', new TextEncoder().encode(canvasHTML(document))],
    ]);
    for (const [name, text] of this.ports.libraries?.() ?? [])
      files.set('runtime/' + name, new TextEncoder().encode(text));
    for (const asset of document.assets)
      files.set(canvasAssetFile(asset), new Uint8Array(await this.assetBytes(asset)));
    return files;
  }
  async export(owner: number, id: string, destination: string): Promise<string> {
    const document = await this.read(owner, id);
    const files = await this.files(document);
    // Every export creates a fresh directory; no existing file is replaced or removed.
    const directory = path.join(destination, 'Viewer canvas ' + randomUUID());
    await mkdir(directory, { mode: 0o700 });
    for (const [name, bytes] of files) {
      const file = path.join(directory, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
    }
    await writeFile(
      path.join(directory, 'canvas.viewer.json'),
      JSON.stringify({
        ...document,
        path: directory,
        assets: document.assets.map(({ source: _source, ...asset }) => asset),
        history: [],
      }),
      { flag: 'wx', mode: 0o600 },
    );
    return directory;
  }
  async import(owner: number, file: string, conversationID: string): Promise<CanvasDocument> {
    const imported = canvasDocumentSchema.parse(
      JSON.parse((await readBounded(file, 16_000_000)).toString('utf8')),
    );
    const directory = await realpath(path.dirname(file));
    const assetDirectory = path.join(directory, 'assets');
    if (imported.assets.length && (await realpath(assetDirectory)) !== assetDirectory)
      throw new Error('Canvas assets must be inside the exported folder, without links.');
    const assets: { asset: CanvasAsset; bytes: Buffer }[] = [];
    for (const asset of imported.assets) {
      const bytes = await readBounded(path.join(directory, canvasAssetFile(asset)), asset.bytes);
      if (
        createHash('sha256').update(bytes).digest('hex') !== asset.hash ||
        bytes.length !== asset.bytes
      )
        throw new Error('An exported canvas asset changed.');
      assets.push({ asset, bytes });
    }
    const created = await this.create(owner, conversationID, path.dirname(file));
    for (const { asset, bytes } of assets) {
      await this.attach(owner, created.id, asset.name, bytes, undefined, asset.provenance);
    }
    // Keep exported IDs because the HTML may refer to them directly.
    return this.serial(() =>
      this.save(owner, {
        ...imported,
        id: created.id,
        conversationID,
        path: path.dirname(file),
        history: [],
        fork: undefined,
        assets: imported.assets.map(({ source: _source, ...asset }) => asset),
      }),
    );
  }
  release(owner: number): void {
    for (const [id, value] of this.owners) if (value === owner) this.owners.delete(id);
  }
  async flush(): Promise<void> {
    await this.queue;
    await Promise.all([...this.stores.values()].map((store) => store.flush()));
  }
}
