import path from 'node:path';
import { z } from 'zod';
import type { ModelProvider } from '../../domain/services';
import { providerKinds } from '../../domain/models/providers';
import {
  modelDataLevels,
  modelEndpoint,
  modelPermissionCovers,
  type ModelDataLevel,
  type ModelDataPermission,
} from '../../domain/models/permissions';
import { DocumentStore } from '../persistence/document-store';

const schema = z
  .object({
    version: z.literal(1),
    permissions: z
      .array(
        z
          .object({
            providerID: z.string().min(1).max(200),
            kind: z.enum(providerKinds),
            endpoint: z.url().max(4000),
            level: z.enum(modelDataLevels),
            agents: z.boolean().optional(),
          })
          .strict(),
      )
      .max(128),
  })
  .strict();
export class ModelPermissionRequired extends Error {
  readonly code = 'MODEL_DATA_PERMISSION_REQUIRED';
  constructor(agent = false) {
    super(
      agent
        ? 'Allow agents to send this data to the provider in Settings → Models before an agent runs this action.'
        : 'Allow this provider to receive the selected data before running the action. Review model data permissions in Settings → Models.',
    );
  }
}

/** Private approvals, never derived from configuration, keys or an agent request. */
export class ModelPermissions {
  private store: DocumentStore<z.infer<typeof schema>>;
  private permissions: ModelDataPermission[] = [];
  private loading?: Promise<void>;
  private writes: Promise<void> = Promise.resolve();
  private blocked = new Map<string, number>();
  private revision = 0;
  private closed = false;
  private active = new Map<AbortController, ModelProvider>();
  private known = new Map<string, string>();
  constructor(
    dataPath: string,
    private providers: () => readonly ModelProvider[],
  ) {
    this.store = new DocumentStore(path.join(dataPath, 'model-permissions-v1.json'), (value) =>
      schema.parse(value),
    );
    for (const provider of providers())
      this.known.set(provider.id, provider.kind + ':' + modelEndpoint(provider));
  }
  private load() {
    return (this.loading ??= this.store
      .load()
      .then((value) => {
        this.permissions = value?.permissions ?? [];
      })
      .catch(() => {
        this.permissions = [];
      }));
  }
  private current(provider: ModelProvider) {
    const current = this.providers().find((item) => item.id === provider.id);
    return (
      !!current &&
      current.kind === provider.kind &&
      modelEndpoint(current) === modelEndpoint(provider)
    );
  }
  private block(id: string) {
    const revision = ++this.revision;
    this.blocked.set(id, revision);
    for (const [controller, provider] of this.active) if (provider.id === id) controller.abort();
    return revision;
  }
  async get(provider: ModelProvider): Promise<ModelDataPermission | null> {
    await this.load();
    if (this.closed || this.blocked.has(provider.id) || !this.current(provider)) return null;
    return structuredClone(
      this.permissions.find(
        (item) =>
          item.providerID === provider.id &&
          item.kind === provider.kind &&
          item.endpoint === modelEndpoint(provider),
      ) ?? null,
    );
  }
  set(provider: ModelProvider, level: ModelDataLevel | null): Promise<void> {
    if (this.closed || !this.current(provider))
      return Promise.reject(new ModelPermissionRequired());
    const revision = this.block(provider.id);
    const work = this.writes
      .catch(() => {})
      .then(async () => {
        await this.load();
        const permissions = this.permissions.filter((item) => item.providerID !== provider.id);
        if (level) {
          if (this.closed || !this.current(provider)) throw new ModelPermissionRequired();
          permissions.push({
            providerID: provider.id,
            kind: provider.kind,
            endpoint: modelEndpoint(provider),
            level,
          });
        }
        const document = schema.parse({ version: 1, permissions });
        await this.store.save(document);
        this.permissions = document.permissions;
        // Failed or superseded writes must never revive a prior approval.
        if (this.blocked.get(provider.id) === revision) this.blocked.delete(provider.id);
      });
    this.writes = work;
    return work;
  }
  /** Lets actions agents start send the approved data too, or no longer. */
  allowAgents(provider: ModelProvider, allow: boolean): Promise<void> {
    if (this.closed || !this.current(provider))
      return Promise.reject(new ModelPermissionRequired());
    const work = this.writes
      .catch(() => {})
      .then(async () => {
        await this.load();
        const existing = this.permissions.find(
          (item) =>
            item.providerID === provider.id &&
            item.kind === provider.kind &&
            item.endpoint === modelEndpoint(provider),
        );
        if (!existing) throw new ModelPermissionRequired();
        const document = schema.parse({
          version: 1,
          permissions: this.permissions.map((item) =>
            item === existing ? { ...item, agents: allow } : item,
          ),
        });
        await this.store.save(document);
        this.permissions = document.permissions;
        if (!allow)
          for (const [controller, active] of this.active)
            if (active.id === provider.id) controller.abort();
      });
    this.writes = work;
    return work;
  }
  reconcile(): Promise<void> {
    if (this.closed) return Promise.resolve();
    const next = new Map(
      this.providers().map((provider) => [
        provider.id,
        provider.kind + ':' + modelEndpoint(provider),
      ]),
    );
    const changed = [...this.known]
      .filter(([id, identity]) => next.get(id) !== identity)
      .map(([id]) => id);
    this.known = next;
    for (const [controller, provider] of this.active)
      if (!this.current(provider)) controller.abort();
    const invalid = this.permissions.filter(
      (item) =>
        !this.providers().some(
          (provider) =>
            item.providerID === provider.id &&
            item.kind === provider.kind &&
            item.endpoint === modelEndpoint(provider),
        ),
    );
    const removed = new Set([...changed, ...invalid.map((item) => item.providerID)]);
    const revisions = [...removed].map((id) => [id, this.block(id)] as const);
    const work = this.writes
      .catch(() => {})
      .then(async () => {
        await this.load();
        const permissions = this.permissions.filter(
          (item) =>
            !removed.has(item.providerID) &&
            this.providers().some(
              (provider) =>
                item.providerID === provider.id &&
                item.kind === provider.kind &&
                item.endpoint === modelEndpoint(provider),
            ),
        );
        if (permissions.length !== this.permissions.length) {
          await this.store.save(schema.parse({ version: 1, permissions }));
          this.permissions = permissions;
        }
        for (const [id, revision] of revisions)
          if (this.blocked.get(id) === revision) this.blocked.delete(id);
      });
    this.writes = work;
    return work;
  }
  async run<T>(
    provider: ModelProvider,
    level: ModelDataLevel,
    signal: AbortSignal,
    work: (signal: AbortSignal) => Promise<T>,
    actor: 'user' | 'agent' = 'user',
  ): Promise<T> {
    await this.writes.catch(() => {});
    const permission = await this.get(provider);
    signal.throwIfAborted();
    // No await between this final check and registering the cancellable request.
    if (
      this.closed ||
      this.blocked.has(provider.id) ||
      !this.current(provider) ||
      !modelPermissionCovers(permission, provider, level, actor)
    )
      throw new ModelPermissionRequired(
        actor === 'agent' && modelPermissionCovers(permission, provider, level),
      );
    const controller = new AbortController();
    this.active.set(controller, structuredClone(provider));
    try {
      const result = await work(AbortSignal.any([signal, controller.signal]));
      controller.signal.throwIfAborted();
      return result;
    } finally {
      this.active.delete(controller);
    }
  }
  async close() {
    this.closed = true;
    for (const controller of this.active.keys()) controller.abort();
    await this.writes.catch(() => {});
  }
}
