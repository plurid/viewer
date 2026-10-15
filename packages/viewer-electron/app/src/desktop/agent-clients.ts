import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { DocumentStore } from './document-store';
import {
  agentClientInputSchema,
  type AgentAudit,
  type AgentCapability,
  type AgentClient,
  type AgentClientInput,
} from '../domain/agent-clients';
const storedClient = agentClientInputSchema
  .extend({
    id: z.uuid(),
    revision: z.number().int().nonnegative(),
    created: z.number(),
    revoked: z.boolean(),
    tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
type PrivateClient = z.infer<typeof storedClient>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const publicClient = (client: PrivateClient): AgentClient => {
  const { tokenHash, ...value } = client;
  void tokenHash;
  return value;
};
/** Authentication/capabilities never live in JSONC and generic file readers cannot access this store. */
export class AgentClients {
  readonly context = new AsyncLocalStorage<string>();
  private records: PrivateClient[] = [];
  private audits: AgentAudit[] = [];
  private clients: DocumentStore<PrivateClient[]>;
  private auditStore: DocumentStore<AgentAudit[]>;
  private loaded?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private auditQueue: Promise<unknown> = Promise.resolve();
  constructor(
    directory: string,
    private access: (paths: readonly string[]) => Promise<void>,
  ) {
    this.clients = new DocumentStore(path.join(directory, 'agent-clients-v1.json'), (value) =>
      z.array(storedClient).max(100).parse(value),
    );
    this.auditStore = new DocumentStore(path.join(directory, 'agent-audit-v1.json'), (value) =>
      z
        .array(
          z
            .object({
              id: z.uuid(),
              at: z.number(),
              clientID: z.string().max(200),
              tool: z.string().max(200),
              status: z.enum(['completed', 'failed']),
              detail: z.string().max(1000),
            })
            .strict(),
        )
        .max(1000)
        .parse(value),
    );
  }
  private load(): Promise<void> {
    return (this.loaded ??= Promise.all([this.clients.load(), this.auditStore.load()])
      .then(([clients, audit]) => {
        this.records = clients ?? [];
        this.audits = audit ?? [];
      })
      .catch((error: unknown) => {
        // A failed read is retried by the next caller instead of disabling this service.
        this.loaded = undefined;
        throw error;
      }));
  }
  async list(): Promise<AgentClient[]> {
    await this.load();
    return this.records.map(publicClient);
  }
  actor(): string {
    return this.context.getStore() ?? 'legacy';
  }
  async get(id = this.actor()): Promise<AgentClient | undefined> {
    await this.load();
    if (id === 'legacy') return;
    const client = this.records.find((client) => client.id === id && !client.revoked);
    if (!client) throw new Error('This agent client is revoked or unavailable.');
    return publicClient(client);
  }
  async require(capability: AgentCapability, id = this.actor()): Promise<AgentClient | undefined> {
    const client = await this.get(id);
    if (client && !client.capabilities.includes(capability))
      throw new Error('This agent client has no ' + capability + ' capability.');
    return client;
  }
  async authenticate(token: string): Promise<string | undefined> {
    await this.load();
    const candidate = Buffer.from(hash(token));
    const client = this.records.find(
      (client) => !client.revoked && timingSafeEqual(candidate, Buffer.from(client.tokenHash)),
    );
    return client?.id;
  }
  private mutate<T>(work: () => Promise<T>): Promise<T> {
    const task = this.queue.catch(() => {}).then(work);
    this.queue = task;
    return task;
  }
  create(input: AgentClientInput): Promise<{ client: AgentClient; token: string }> {
    const value = agentClientInputSchema.parse(input);
    return this.mutate(async () => {
      await this.load();
      await this.access(value.roots);
      if (this.records.length >= 100)
        throw new Error('Remove an old agent client before creating another.');
      const token = randomBytes(32).toString('hex');
      const client: PrivateClient = {
        ...value,
        id: randomUUID(),
        revision: 1,
        created: Date.now(),
        revoked: false,
        tokenHash: hash(token),
      };
      await this.clients.save([...this.records, client]);
      this.records.push(client);
      return { client: publicClient(client), token };
    });
  }
  update(id: string, revision: number, input?: AgentClientInput): Promise<AgentClient> {
    const value = input && agentClientInputSchema.parse(input);
    return this.mutate(async () => {
      await this.load();
      const original = this.records.find((client) => client.id === id);
      if (!original || original.revision !== revision)
        throw new Error('The client changed. Reload its permissions.');
      if (value) await this.access(value.roots);
      const client = {
        ...original,
        ...value,
        revision: revision + 1,
        revoked: !value || original.revoked,
      };
      const records = this.records.map((record) => (record.id === id ? client : record));
      await this.clients.save(records);
      this.records = records;
      return publicClient(client);
    });
  }
  async audit(
    tool: string,
    status: AgentAudit['status'],
    detail: string,
    clientID = this.actor(),
  ): Promise<void> {
    const work = this.auditQueue
      .catch(() => {})
      .then(async () => {
        await this.load();
        const audit: AgentAudit = {
          id: randomUUID(),
          at: Date.now(),
          clientID,
          tool,
          status,
          detail: detail.slice(0, 1000),
        };
        this.audits = [...this.audits.slice(-999), audit];
        await this.auditStore.save(this.audits);
      });
    this.auditQueue = work;
    await work;
  }
  async history(clientID?: string): Promise<AgentAudit[]> {
    await this.load();
    return this.audits.filter((entry) => !clientID || entry.clientID === clientID);
  }
  async close() {
    await this.queue.catch(() => {});
    await this.auditQueue.catch(() => {});
    await Promise.all([this.clients.flush(), this.auditStore.flush()]);
  }
}
