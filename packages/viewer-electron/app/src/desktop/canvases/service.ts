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
import type { InspectionResult } from '../../domain/files/inspection';
import type { CanvasResult } from '../../domain/canvases/results';
import { canvasResultSchema } from '../../domain/canvases/results';
import { portableCanvasSources } from '../../domain/canvases/sources';
import { sourceHash, sourceSnapshot } from './sources';
import { CanvasObservations } from './observations';
import type { CanvasObservation } from './observations';
import { robotTaskSchema } from '../../domain/robotics/task';
import { canvasRobotReport, compareCanvasRobots, robotInputHash } from './robot-check';
import type { RobotComparisonReport } from '../../domain/robotics/task';
import { checkRobotTask } from '../robotics/check';
import { CanvasActions } from './actions';
import type { CanvasActionEvent } from '../../domain/canvases/actions';
import { errorMessage } from '../../domain/errors';
import { placementStudySchema } from '../../domain/robotics/placement';
import { checkPlacements } from '../robotics/placement';
import {
  placementBrief,
  placementInputHash,
  canvasPlacementReport,
  comparePlacements,
} from './placement-check';

interface CanvasPorts {
  changed(owner: number, document: CanvasDocument): void;
  action?(owner: number, event: CanvasActionEvent): void;
  libraries?: () => ReadonlyMap<string, string>;
  observe?: boolean;
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
  readonly actions: CanvasActions;
  private observations = new CanvasObservations();
  private stores = new Map<string, DocumentStore<CanvasDocument>>();
  private owners = new Map<string, number>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private root: string,
    private ports: CanvasPorts,
  ) {
    this.actions = new CanvasActions((owner, event) => this.ports.action?.(owner, event));
  }

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
    for (const source of [...document.sources, ...document.history.flatMap((item) => item.sources)])
      if (source.hash !== sourceHash(source.data))
        throw new Error('A canvas source snapshot changed.');
    this.owners.set(id, owner);
    return document;
  }
  read(owner: number, id: string): Promise<CanvasDocument> {
    return this.serial(() => this.load(owner, id));
  }
  private async save(
    owner: number,
    value: CanvasDocument,
    invocationID?: string,
  ): Promise<CanvasDocument> {
    const document = canvasDocumentSchema.parse(value);
    await this.store(document.id).save(document);
    this.actions.invalidate(document, invocationID);
    this.owners.set(document.id, owner);
    this.ports.changed(owner, structuredClone(document));
    return document;
  }
  create(owner: number, conversationID: string, directory: string): Promise<CanvasDocument> {
    return this.serial(() =>
      this.save(owner, {
        version: 2,
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
        sources: [],
        history: [],
        at: Date.now(),
      }),
    );
  }
  private revise(document: CanvasDocument, update: Partial<CanvasDocument>): CanvasDocument {
    const { revision, title, html, defaults, assets, sources, at } = document;
    return {
      ...document,
      ...update,
      revision: revision + 1,
      at: Date.now(),
      history: [
        ...document.history,
        { revision, title, html, defaults, assets, sources, at },
      ].slice(-canvasLimits.history),
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
      if (this.actions.busy(id))
        throw new Error('An action is running. Choose Take over to edit its inputs.');
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
          sources: branch.sources,
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
  async attachFile(
    owner: number,
    id: string,
    file: string,
    validate?: (bytes: Uint8Array) => void,
  ): Promise<CanvasAsset> {
    const data = await readBounded(file, canvasLimits.assetBytes);
    validate?.(data);
    return this.attach(owner, id, path.basename(file), data, file);
  }
  source(
    owner: number,
    id: string,
    expected: number,
    inspection: InspectionResult,
    sourceID?: string,
  ) {
    return this.serial(async () => {
      const document = await this.load(owner, id);
      if (document.revision !== expected)
        throw new Error('The canvas changed. Review its current sources.');
      const existing = document.sources.find(
        (source) => source.id === sourceID || source.path === inspection.path,
      );
      if (sourceID && !existing) throw new Error('This source is no longer attached.');
      if (existing && !sourceID) return { source: existing, revision: document.revision };
      const source = sourceSnapshot(inspection, existing?.id);
      const sources = existing
        ? document.sources.map((item) => (item.id === existing.id ? source : item))
        : [...document.sources, source];
      const updated = await this.save(owner, this.revise(document, { sources }));
      return { source, revision: updated.revision };
    });
  }
  async observe(owner: number, id: string, revision: number, value: CanvasObservation) {
    const document = await this.read(owner, id);
    if (document.revision === revision) this.observations.record(id, revision, value);
    return document;
  }
  previewObservation(id: string, revision: number) {
    return this.observations.read(id, revision);
  }
  async waitForPreview(id: string, revision: number, signal: AbortSignal) {
    return this.ports.observe
      ? this.observations.wait(id, revision, signal)
      : this.observations.read(id, revision);
  }
  registerActions(owner: number, id: string, revision: number, frameID: string, actions: unknown) {
    return this.serial(async () => {
      const document = await this.load(owner, id);
      if (document.revision !== revision)
        throw new Error('This canvas revision is no longer current.');
      this.actions.register(owner, document, frameID, actions);
      return document;
    });
  }
  async invoke(
    owner: number,
    id: string,
    revision: number,
    stateRevision: number,
    action: string,
    input: unknown,
    actor: string,
    signal: AbortSignal,
    conversationID?: string,
  ) {
    const pending = await this.serial(async () => {
      const document = await this.load(owner, id);
      if (conversationID && document.conversationID !== conversationID)
        throw new Error('This action belongs to another conversation.');
      if (document.revision !== revision || document.stateRevision !== stateRevision)
        throw new Error('The canvas inputs changed. Read them before running an action.');
      return this.actions.start(
        owner,
        document,
        action,
        input,
        actor,
        signal,
        conversationID ? 'model' : 'user',
      );
    });
    try {
      const output = await pending.result;
      const document = await this.serial(async () => {
        this.actions.assertCurrent(id, pending.run.id);
        signal.throwIfAborted();
        const current = await this.load(owner, id);
        if (current.revision !== revision || current.stateRevision !== stateRevision)
          throw new Error('The canvas changed while the action ran. Its result was not applied.');
        if (!output.patch || !Object.keys(output.patch).length) {
          this.actions.commit(id, pending.run.id, signal);
          return current;
        }
        const patch = canvasStateSchema.parse(output.patch);
        retainedCanvasState(current.state, patch);
        this.actions.commit(id, pending.run.id, signal);
        return this.save(
          owner,
          {
            ...current,
            state: canvasStateSchema.parse({ ...current.state, ...patch }),
            stateRevision: current.stateRevision + 1,
          },
          pending.run.id,
        );
      });
      this.actions.finish(id, pending.run.id, 'completed', output.result);
      return { document, actionRun: this.actions.activity(id)! };
    } catch (error) {
      this.actions.finish(id, pending.run.id, 'failed', undefined, errorMessage(error));
      if (signal.aborted) throw error;
      return { document: await this.read(owner, id), actionRun: this.actions.activity(id)! };
    }
  }
  async saveResult(
    owner: number,
    id: string,
    revision: number,
    stateRevision: number,
    input: CanvasResult,
    choose: () => Promise<string | undefined>,
    validate?: (document: CanvasDocument) => void | Promise<void>,
  ): Promise<string | undefined> {
    const result = canvasResultSchema.parse(input);
    const check = async () => {
      const document = await this.read(owner, id);
      if (document.revision !== revision || document.stateRevision !== stateRevision)
        throw new Error('The canvas or its inputs changed. Prepare the result again.');
      await validate?.(document);
    };
    await check();
    const destination = await choose();
    if (!destination) return;
    return this.serial(async () => {
      const document = await this.load(owner, id);
      if (document.revision !== revision || document.stateRevision !== stateRevision)
        throw new Error('The canvas or its inputs changed. Prepare the result again.');
      await validate?.(document);
      // Exclusive creation preserves existing destinations, including links. A failed write is kept.
      const handle = await open(destination, 'wx', 0o600);
      try {
        await handle.writeFile(result.content, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      return destination;
    });
  }
  checkRobot(
    owner: number,
    id: string,
    revision: number,
    stateRevision: number,
    sourceID: string,
    stateKey: string,
  ) {
    return this.serial(async () => {
      const document = await this.load(owner, id);
      if (document.revision !== revision || document.stateRevision !== stateRevision)
        throw new Error('The canvas or its inputs changed. Check the saved task again.');
      const source = document.sources.find((source) => source.id === sourceID);
      if (!source?.data.robot) throw new Error('Choose a bound robot source.');
      const input = robotTaskSchema.parse(document.state[stateKey]);
      checkRobotTask(source.data.robot, input);
      return this.save(owner, {
        ...document,
        robotCheck: {
          sourceID,
          stateKey,
          revision,
          sourceHash: source.hash,
          inputHash: robotInputHash(input),
          checker: 'position-v1',
          at: Date.now(),
        },
      });
    });
  }
  checkPlacements(
    owner: number,
    id: string,
    revision: number,
    stateRevision: number,
    sourceID: string,
    briefSourceID: string,
    stateKey: string,
  ) {
    return this.serial(async () => {
      const document = await this.load(owner, id);
      if (document.revision !== revision || document.stateRevision !== stateRevision)
        throw new Error('The study changed. Check its current saved inputs.');
      const source = document.sources.find((s) => s.id === sourceID);
      const brief = document.sources.find((s) => s.id === briefSourceID);
      if (!source?.data.robot || !brief)
        throw new Error('Bind the robot and placement brief first.');
      const input = placementStudySchema.parse(document.state[stateKey]);
      checkPlacements(source.data.robot, placementBrief(brief), input);
      return this.save(owner, {
        ...document,
        placementCheck: {
          sourceID,
          briefSourceID,
          stateKey,
          revision,
          sourceHash: source.hash,
          briefHash: brief.hash,
          inputHash: placementInputHash(input),
          checker: 'placement-v1',
          at: Date.now(),
        },
      });
    });
  }
  placementComparison(owner: number, id: string) {
    return this.serial(async () => {
      const alternative = await this.load(owner, id);
      if (!alternative.fork)
        return { status: 'unavailable' as const, reason: 'This study has no quoted original.' };
      return comparePlacements(await this.load(owner, alternative.fork.id), alternative);
    });
  }
  async savePlacementCheck(
    owner: number,
    id: string,
    revision: number,
    stateRevision: number,
    choose: () => Promise<string | undefined>,
  ) {
    const document = await this.read(owner, id);
    const report = canvasPlacementReport(document);
    if (report?.status !== 'checked')
      throw new Error('Check the current placements before saving.');
    const binding = document.placementCheck!;
    return this.saveResult(
      owner,
      id,
      revision,
      stateRevision,
      {
        format: 'json',
        name: 'placement-check.json',
        content: JSON.stringify(
          {
            version: 1,
            checker: binding.checker,
            sourceHash: binding.sourceHash,
            briefHash: binding.briefHash,
            inputHash: binding.inputHash,
            ...report,
          },
          null,
          2,
        ),
      },
      choose,
      (current) => {
        if (JSON.stringify(current.placementCheck) !== JSON.stringify(binding))
          throw new Error('The placement check changed during save review.');
      },
    );
  }
  async saveRobotCheck(
    owner: number,
    id: string,
    revision: number,
    stateRevision: number,
    choose: () => Promise<string | undefined>,
  ) {
    const document = await this.read(owner, id);
    const report = canvasRobotReport(document);
    if (!report || report.status !== 'checked')
      throw new Error('Check the current task before saving the result.');
    const source = document.sources.find((source) => source.id === document.robotCheck!.sourceID)!;
    return this.saveResult(
      owner,
      id,
      revision,
      stateRevision,
      {
        format: 'json',
        name: 'robot-check.json',
        content: JSON.stringify(
          {
            version: 1,
            checker: document.robotCheck!.checker,
            source: { name: source.name, hash: source.hash, version: source.version },
            inputHash: document.robotCheck!.inputHash,
            ...report,
          },
          null,
          2,
        ),
      },
      choose,
      (current) => {
        if (JSON.stringify(current.robotCheck) !== JSON.stringify(document.robotCheck))
          throw new Error('The selected robot check changed. Review the current result.');
      },
    );
  }
  robotComparison(owner: number, id: string): Promise<RobotComparisonReport> {
    return this.serial(async () => {
      const alternative = await this.load(owner, id);
      if (!alternative.fork)
        return { status: 'unavailable', reason: 'This canvas has no original to compare.' };
      return compareCanvasRobots(await this.load(owner, alternative.fork.id), alternative);
    });
  }
  async saveRobotComparison(
    owner: number,
    id: string,
    revision: number,
    stateRevision: number,
    choose: () => Promise<string | undefined>,
  ) {
    const comparison = await this.robotComparison(owner, id);
    if (comparison.status !== 'compared') throw new Error(comparison.reason);
    return this.saveResult(
      owner,
      id,
      revision,
      stateRevision,
      {
        format: 'json',
        name: 'robot-comparison.json',
        content: JSON.stringify({ version: 1, checker: 'position-v1', ...comparison }, null, 2),
      },
      choose,
      async (current) => {
        if (
          !current.fork ||
          JSON.stringify(compareCanvasRobots(await this.load(owner, current.fork.id), current)) !==
            JSON.stringify(comparison)
        )
          throw new Error('One of the compared tasks changed. Review the comparison again.');
      },
    );
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
        sources: portableCanvasSources(document.sources),
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
    for (const source of imported.sources)
      if (source.hash !== sourceHash(source.data))
        throw new Error('An exported source snapshot changed.');
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
        sources: portableCanvasSources(imported.sources),
      }),
    );
  }
  release(owner: number): void {
    this.actions.release(owner);
    for (const [id, value] of this.owners)
      if (value === owner) {
        this.owners.delete(id);
        this.observations.forget(id);
      }
  }
  async flush(): Promise<void> {
    // Rejected requests were reported to their callers; still flush later persisted work.
    await this.queue.catch(() => {});
    await Promise.all([...this.stores.values()].map((store) => store.flush()));
  }
}
