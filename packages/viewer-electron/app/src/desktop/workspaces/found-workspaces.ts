import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { rename } from 'node:fs/promises';
import { z } from 'zod';
import type { SavedState } from '../../domain/contracts';
import type { FileChange } from '../../domain/files/changes';
import { pathMapper } from '../../domain/files/changes';
import { readItemIdentity, sameIdentity } from '../../domain/files/item-identity';
import type { WorkspaceDefinition } from '../../domain/workspaces/definitions/schema';
import { definitionKeySchema } from '../../domain/workspaces/definitions/schema';
import { folderGitMarkers } from '../../domain/workspaces/folder-facts';
import type { FoundEntry, FoundCatalogState, FoundKeyChange } from '../../domain/workspaces/found/catalog';
import { foundDefinitions } from '../../domain/workspaces/found/catalog';
import { candidateFolders, qualifyingRoots } from '../../domain/workspaces/found/candidates';
import type { FoundRootContext } from '../../domain/workspaces/found/roots';
import { foundKey } from '../../domain/workspaces/found/keys';
import {
  allowedFoundFolder,
  insideRoot,
  rootAncestors,
  rootFor,
} from '../../domain/workspaces/found/roots';
import type { FolderFacts } from './folder-facts';
import type { FoundProbePass } from './found-probes';
import { probeFoundFolders } from './found-probes';
import { sameJSON } from '../../domain/json';
import { DocumentStore } from '../persistence/document-store';
import { lstat } from '../files/stats';

const identity = z
  .string()
  .max(50)
  .refine((value) => readItemIdentity(value) !== undefined);
const folder = z.string().min(1).max(4096);
const time = z.number().finite().nonnegative();
const entrySchema = z
  .object({
    key: definitionKeySchema,
    root: folder,
    realpath: folder,
    identity,
    names: z.array(z.string().max(200)).max(3),
    at: time,
  })
  .strict();
const probeSchema = z
  .object({
    folder,
    at: time,
    expires: time.optional(),
    value: z
      .object({
        path: folder,
        identity,
        markers: z.array(z.string().max(256)).max(100),
        capped: z.boolean(),
        git: z.enum(folderGitMarkers).optional(),
        package: z
          .object({
            name: z.string().max(200).optional(),
            workspaces: z.boolean().optional(),
            packageManager: z.string().max(200).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();
const referenceSchema = z
  .object({ root: folder, source: z.string().max(100), name: z.string().min(1).max(100), at: time })
  .strict();
const documentSchema = z
  .object({
    version: z.literal(1),
    entries: z.array(entrySchema).max(1800),
    hidden: z.array(folder).max(500),
    probes: z.array(probeSchema).max(1000),
    lastRun: z.array(referenceSchema).max(200),
    rekeys: z.array(z.object({ from: definitionKeySchema, to: definitionKeySchema }).strict()).max(1800).optional(),
  })
  .strict()
  .refine(
    (value) => new Set(value.entries.map((entry) => entry.key)).size === value.entries.length,
  );
type FoundDocument = z.infer<typeof documentSchema>;
export interface FoundWorkspacePorts {
  facts: Pick<FolderFacts, 'pass' | 'probe'>;
  state(): SavedState | undefined;
  enabled(): boolean;
  explicit(): readonly WorkspaceDefinition[];
  aliases?(): Readonly<Record<string, string>>;
  retained(key: string): boolean;
  keepOnClear?(key: string): boolean;
  rekey?(changes: readonly FoundKeyChange[]): Promise<void>;
  localVolumes(): readonly string[];
  nonLocalRoots?(): readonly string[];
  access?(folder: string): boolean;
  scopeRoot?(folder: string): string | undefined;
  emptyLocation?(): string;
  now?(): number;
}
export class FoundWorkspaces {
  readonly store: DocumentStore<FoundDocument>;
  private document: FoundDocument = {
    version: 1,
    entries: [],
    hidden: [],
    probes: [],
    lastRun: [],
  };
  private listeners = new Set<() => void>();
  private loading?: Promise<void>;
  private writes: Promise<void> = Promise.resolve();
  private running?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private lastPass = 0;
  private epoch = 0;
  private started = false;
  private stopped = false;
  private written = false;
  private writtenText?: string;
  private retainedFile = false;
  private needsRecovery = false;
  private configured?: boolean;
  private cancellation?: AbortController;
  private remapWrite?: ReturnType<typeof setTimeout>;
  private state: FoundCatalogState['state'] = 'loading';
  recovery?: string;
  constructor(
    directory: string,
    readonly home: string,
    private ports: FoundWorkspacePorts,
  ) {
    this.store = new DocumentStore(
      path.join(directory, 'found-workspaces-v1.json'),
      (value) => {
        if (Buffer.byteLength(JSON.stringify(value)) > 1_000_000)
          throw new Error('Found workspace metadata exceeds 1 MB.');
        return documentSchema.parse(value);
      },
      1_000_000,
    );
  }
  private now() {
    return this.ports.now?.() ?? Date.now();
  }
  load(): Promise<void> {
    return (this.loading ??= (async () => {
      try {
        const value = await this.store.load();
        if (value) {
          this.document = value;
          this.written = true;
          this.writtenText = JSON.stringify(value);
        }
      } catch {
        this.needsRecovery = true;
        this.retainedFile = true;
        this.recovery = 'Unreadable found workspace metadata remains protected until finding resumes.';
      }
      this.configured = this.ports.enabled();
      if (!this.configured) this.state = 'off';
    })());
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(): void {
    if (!this.stopped) for (const listener of this.listeners) listener();
  }
  private async prepareWrite(): Promise<void> {
    if (!this.needsRecovery) return;
    this.needsRecovery = false;
    try {
      if (!(await lstat(this.store.file)).isFile()) throw new Error('Found metadata is not a regular file.');
      await rename(this.store.file, this.store.file + '.unreadable-' + randomUUID());
      this.retainedFile = false;
      this.recovery = 'Unreadable found workspaces were kept aside. Viewer can find folders again.';
    } catch {
      this.recovery = 'Found workspace metadata could not be read or kept aside. It remains protected.';
    }
  }
  available(root: string): boolean {
    const volume = /^\/Volumes\/[^/]+/.exec(root)?.[0];
    return !volume || this.ports.localVolumes().includes(volume);
  }
  snapshot(explicit: readonly WorkspaceDefinition[] = this.ports.explicit()) {
    const context = {
      home: this.home,
      localVolumes: [...new Set([
        ...this.ports.localVolumes(),
        ...this.document.entries.flatMap((entry) => /^\/Volumes\/[^/]+/.exec(entry.root)?.[0] ?? []),
      ])],
      nonLocalRoots: this.ports.nonLocalRoots?.(),
    };
    const entries = this.ports.enabled()
      ? this.document.entries.filter(
          (entry) =>
            allowedFoundFolder(entry.root, context) &&
            allowedFoundFolder(entry.realpath, context) &&
            !this.document.hidden.includes(entry.root) &&
            (!this.ports.access || this.ports.access(entry.root)),
        )
      : [];
    const probes = new Map(this.document.probes.map((probe) => [probe.folder, probe.value.path]));
    for (const [from, to] of Object.entries(this.ports.aliases?.() ?? {})) {
      let old = from;
      let actual = to;
      probes.set(old, actual);
      for (let depth = 0; depth < 16 && path.basename(old) === path.basename(actual); depth++) {
        old = path.dirname(old);
        actual = path.dirname(actual);
        if (old === '/' || actual === '/') break;
        if (!probes.has(old)) probes.set(old, actual);
      }
    }
    const definitions = foundDefinitions(
      entries,
      explicit,
      this.home,
      (text) => createHash('sha256').update(text).digest('hex'),
      (root) => probes.get(root) ?? root,
    );
    return {
      definitions,
      state: {
        state: this.ports.enabled() ? this.state : 'off',
        count: definitions.length,
        hidden: this.document.hidden.length,
      } as FoundCatalogState,
    };
  }
  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.schedule(10_000);
  }
  historyChanged(): void {
    if (!this.started || this.stopped || !this.ports.enabled()) return;
    const state = this.ports.state();
    if (!state) return;
    const roots = this.document.entries.map((entry) => entry.root);
    if (
      Object.entries(state.visits ?? {}).some(
        ([folder, visit]) => visit.last > this.lastPass && !roots.some((root) => insideRoot(root, folder)),
      )
    )
      this.schedule(Math.max(30_000, this.lastPass + 300_000 - this.now()));
  }
  private schedule(delay: number): void {
    if (this.timer || this.stopped) return;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        void this.run().catch(() => {});
      },
      Math.max(0, delay),
    );
  }
  async configure(): Promise<void> {
    await this.load();
    if (this.configured === this.ports.enabled()) return;
    this.configured = this.ports.enabled();
    if (this.ports.enabled()) {
      if (this.state === 'off') {
        this.state = 'loading';
        this.schedule(10_000);
      }
      return;
    }
    if (this.state === 'off' && !this.document.entries.length && !this.document.probes.length)
      return;
    this.epoch++;
    this.cancellation?.abort();
    clearTimeout(this.timer);
    this.timer = undefined;
    this.document.entries = [];
    this.document.probes = [];
    this.state = 'off';
    await this.persist();
    this.emit();
  }
  run(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.scan().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async scan(): Promise<void> {
    await this.load();
    if (this.stopped) return;
    await this.prepareWrite();
    if (!this.ports.enabled()) {
      this.document.entries = [];
      this.document.probes = [];
      this.state = 'off';
      await this.persist();
      return;
    }
    const retainedBefore = new Set(this.document.entries.filter((entry) => this.ports.retained(entry.key)).map((entry) => entry.root));
    await this.reconcileKeys();
    const saved = this.ports.state();
    if (!saved || this.stopped) return;
    const controller = new AbortController();
    this.cancellation = controller;
    const now = this.now();
    this.lastPass = now;
    const context = {
      home: this.home,
      localVolumes: this.ports.localVolumes(),
      nonLocalRoots: this.ports.nonLocalRoots?.(),
      hidden: this.document.hidden,
    };
    const candidates = candidateFolders({
      home: this.home,
      now,
      visits: saved.visits ?? {},
      recents: saved.recents,
      workspaces: saved.workspaces,
      workspaceVisits: saved.workspaceVisits,
      openWindows: [...(saved.openWindows ?? []), saved.activeWorkspace],
      emptyLocation: this.ports.emptyLocation?.(),
    }).filter((item) => allowedFoundFolder(item.folder, context));
    const walks = new Map(candidates.map((item) => [
      item.folder,
      rootAncestors(item.folder, { ...context, scopeRoot: this.ports.scopeRoot?.(item.folder) }),
    ]));
    const pass = await probeFoundFolders({
      facts: this.ports.facts,
      records: this.document.probes,
      folders: [
        ...this.ports.explicit().slice(0, 50).map((entry) => entry.root),
        ...[...walks.values()].flatMap((walk) => [...walk].reverse()),
      ],
      context,
      access: this.ports.access,
      now: () => this.now(),
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    const initial = this.decideRoots(walks, pass, context);
    const claims = await this.settleClaims(initial.roots, pass);
    if (controller.signal.aborted) return;
    const decision = this.decideRoots(walks, pass, context);
    const retained = new Set([
      ...this.document.entries.filter((entry) =>
        this.ports.retained(entry.key) || retainedBefore.has(entry.root) || !this.available(entry.root),
      ).map((entry) => entry.root),
      ...decision.carried,
      ...[...claims.owners].filter(([, entry]) => this.ports.retained(entry.key)).map(([root]) => root),
    ]);
    const roots = qualifyingRoots(
      [...decision.roots, ...retained].filter((root) => !claims.displaced.has(root) && !claims.blocked.has(root)),
      candidates,
      now,
      retained,
    );
    const before = JSON.stringify(this.document.entries);
    const previousState = this.state;
    this.document.entries = this.mintEntries(roots, pass, claims.owners, saved, now);
    this.document.probes = [...pass.cache.values()].sort((a, b) => b.at - a.at).slice(0, 1000);
    this.state = 'ready';
    await this.persist();
    if (previousState !== this.state || before !== JSON.stringify(this.document.entries)) this.emit();
  }

  private decideRoots(
    walks: ReadonlyMap<string, readonly string[]>,
    pass: FoundProbePass,
    context: FoundRootContext,
  ): { roots: string[]; carried: Set<string> } {
    const roots: string[] = [];
    const carried = new Set<string>();
    for (const [folder, walk] of walks) {
      const complete = walk.length > 0 && walk.every((path) =>
        !pass.unknown.has(path) && (pass.facts.has(path) || pass.missing.has(path)),
      );
      if (!complete) {
        for (const entry of this.document.entries)
          if (insideRoot(entry.root, folder)) carried.add(entry.root);
        continue;
      }
      if (walk.some((path) => pass.missing.has(path))) continue;
      const root = rootFor(folder, pass.facts, { ...context, scopeRoot: this.ports.scopeRoot?.(folder) });
      if (root) roots.push(root);
    }
    return { roots, carried };
  }

  private async settleClaims(roots: readonly string[], pass: FoundProbePass) {
    const owners = new Map<string, FoundEntry>();
    const displaced = new Set<string>();
    const blocked = new Set<string>();
    for (const root of new Set(roots)) {
      const value = pass.facts.get(root);
      const previous = value && this.document.entries.find((entry) =>
        entry.root !== root && entry.realpath !== value.path && sameIdentity(entry.identity, value.identity),
      );
      if (!previous || !value) continue;
      if (!pass.fresh.has(root) && !(await pass.read(root, true))) {
        blocked.add(root);
        continue;
      }
      if (!pass.fresh.has(root) || !sameIdentity(previous.identity, pass.facts.get(root)!.identity)) continue;
      if (!pass.fresh.has(previous.root) && !pass.missing.has(previous.root))
        if (!(await pass.read(previous.root, true))) {
          blocked.add(root);
          continue;
        }
      const old = pass.facts.get(previous.root);
      if (pass.fresh.has(previous.root) && old && sameIdentity(old.identity, previous.identity)) {
        blocked.add(root);
        continue;
      }
      owners.set(root, previous);
      if (!old || !pass.fresh.has(previous.root) || sameIdentity(old.identity, previous.identity))
        displaced.add(previous.root);
    }
    return { owners, displaced, blocked };
  }

  private manifestNames(root: string, pass: FoundProbePass): string[] {
    const first = pass.facts.get(root)?.package?.name;
    const names = [...pass.facts].filter(([folder]) => insideRoot(root, folder))
      .flatMap(([, value]) => value.package?.name ?? []).sort();
    return [...new Set([...(first ? [first] : []), ...names])].slice(0, 3);
  }

  private mintEntries(
    roots: readonly string[],
    pass: FoundProbePass,
    owners: ReadonlyMap<string, FoundEntry>,
    saved: SavedState,
    now: number,
  ): FoundEntry[] {
    const taken = new Set([
      ...this.ports.explicit().map((entry) => entry.key),
      ...this.document.entries.map((entry) => entry.key),
    ]);
    const claimed = new Set([...owners.values()].map((entry) => entry.key));
    return roots.flatMap((root): FoundEntry[] => {
      const value = pass.facts.get(root);
      const previous = owners.get(root) ?? this.document.entries.find((entry) =>
        entry.root === root && !claimed.has(entry.key),
      );
      if (!value || pass.unknown.has(root)) return previous ? [previous] : [];
      const key = previous?.key ?? foundKey(root, this.home, taken);
      taken.add(key);
      const lastVisit = Math.max(0, ...Object.entries(saved.visits ?? {})
        .filter(([folder]) => insideRoot(root, folder)).map(([, visit]) => visit.last));
      return [{
        key,
        root,
        realpath: value.path,
        identity: value.identity,
        names: this.manifestNames(root, pass),
        at: previous ? Math.max(previous.at, lastVisit) : now,
      }];
    });
  }

  async reconcileKeys(): Promise<void> {
    await this.load();
    const explicit = new Set(this.ports.explicit().map((entry) => entry.key));
    const taken = new Set([...explicit, ...this.document.entries.map((entry) => entry.key)]);
    const changes: FoundKeyChange[] = [];
    this.document.entries = this.document.entries.map((entry) => {
      if (!explicit.has(entry.key)) return entry;
      const key = foundKey(entry.root, this.home, taken);
      taken.add(key);
      changes.push({ from: entry.key, to: key });
      return { ...entry, key };
    });
    if (changes.length) {
      this.document.rekeys = [...(this.document.rekeys ?? []), ...changes];
      await this.persist();
    }
    if (this.document.rekeys?.length) {
      await this.ports.rekey?.(this.document.rekeys);
      delete this.document.rekeys;
      await this.persist();
    }
  }
  private persist(): Promise<void> {
    const work = this.writes
      .catch(() => {})
      .then(async () => {
        await this.prepareWrite();
        if (
          this.retainedFile ||
          (!this.written &&
            !this.document.entries.length &&
            !this.document.hidden.length &&
            !this.document.lastRun.length)
        )
          return;
        const next = structuredClone(this.document);
        let bytes = Buffer.byteLength(JSON.stringify(next));
        const trim = (items: unknown[]) => {
          while (bytes > 1_000_000 && items.length) {
            const removed = items.pop();
            bytes -= Buffer.byteLength(JSON.stringify(removed)) + Number(items.length > 0);
          }
        };
        trim(next.probes);
        trim(next.lastRun);
        while (bytes > 1_000_000) {
          const index = next.entries.findLastIndex((entry) => !this.ports.retained(entry.key));
          if (index < 0) {
            this.recovery = 'Found workspace metadata cannot fit its retained entries in the 1 MB limit. The previous file remains in effect.';
            return;
          }
          const [removed] = next.entries.splice(index, 1);
          bytes -= Buffer.byteLength(JSON.stringify(removed)) + Number(next.entries.length > 0);
        }
        this.document.probes = next.probes;
        this.document.entries = next.entries;
        this.document.lastRun = next.lastRun;
        const text = JSON.stringify(next);
        if (text === this.writtenText) return;
        await this.store.save(next);
        this.writtenText = text;
        this.written = true;
      });
    this.writes = work;
    return work;
  }
  async clearHistory(): Promise<void> {
    await this.load();
    this.epoch++;
    this.cancellation?.abort();
    clearTimeout(this.timer);
    this.timer = undefined;
    this.lastPass = 0;
    this.document.entries = this.document.entries.filter((entry) =>
      this.ports.keepOnClear ? this.ports.keepOnClear(entry.key) : this.ports.retained(entry.key),
    );
    this.document.probes = [];
    this.document.lastRun = [];
    this.state = this.ports.enabled() ? 'ready' : 'off';
    await this.persist();
    this.emit();
  }
  async remap(changes: readonly FileChange[]): Promise<void> {
    await this.load();
    const map = pathMapper(changes);
    const entries = this.document.entries.map((entry) => ({
      ...entry,
      root: map(entry.root),
      realpath: map(entry.realpath),
    }));
    const hidden = this.document.hidden.map(map);
    const probes = this.document.probes.map((probe) => ({
      ...probe,
      folder: map(probe.folder),
      value: { ...probe.value, path: map(probe.value.path) },
    }));
    const lastRun = this.document.lastRun.map((entry) => ({
      ...entry,
      root: map(entry.root),
    }));
    const next = { ...this.document, entries, hidden, probes, lastRun };
    if (sameJSON(this.document, next)) return;
    this.epoch++;
    this.cancellation?.abort();
    this.document = next;
    clearTimeout(this.remapWrite);
    this.remapWrite = setTimeout(() => {
      this.remapWrite = undefined;
      void this.persist().catch(() => {});
    }, 25);
    this.emit();
  }
  async recordRun(
    root: string,
    reference: { source: string; name: string; at: number },
  ): Promise<void> {
    await this.load();
    const value = referenceSchema.parse({ root, ...reference });
    this.document.lastRun = [
      value,
      ...this.document.lastRun.filter((item) => item.root !== root),
    ].slice(0, 200);
    await this.persist();
  }
  async close(): Promise<void> {
    this.stopped = true;
    this.epoch++;
    this.cancellation?.abort();
    clearTimeout(this.timer);
    if (this.remapWrite) {
      clearTimeout(this.remapWrite);
      this.remapWrite = undefined;
      await this.persist().catch(() => {});
    }
    await this.writes.catch(() => {});
    await this.store.flush().catch(() => {});
  }
}
