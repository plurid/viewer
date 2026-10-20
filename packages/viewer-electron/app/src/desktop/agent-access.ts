import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { DocumentStore } from './document-store';
import { absolute } from './filesystem';
import {
  agentCapabilities,
  type AgentAccessState,
  type AgentCapability,
} from '../domain/agent-clients';

/** What config.jsonc asks for (`settings.agents`), or nothing while it cannot be read. */
export interface RequestedAgentAccess {
  enabled: boolean;
  roots: readonly string[];
}
const approvalSchema = z
  .object({
    version: z.literal(1),
    enabled: z.boolean(),
    roots: z.array(z.string().min(1).max(32768)).max(100),
    /** The shared connection's capabilities; absent, every one, as before they could be narrowed. */
    capabilities: z.array(z.enum(agentCapabilities)).max(agentCapabilities.length).optional(),
  })
  .strict();
type Approval = z.infer<typeof approvalSchema>;
const canonical = (root: string) =>
  realpath(absolute(root)).catch(() => path.resolve(absolute(root)));

/**
 * THE PERSON'S APPROVAL OF AGENT ACCESS (2026-10-20). `settings.agents` in config.jsonc switched the
 * agent server on and named the shared connection's folders, so an external edit, an Import or the
 * workspace window could widen what a token already in an MCP client reached, with no prompt. The
 * approval is kept here, private (mode 0600, beside the token), and config.jsonc only narrows it:
 * turning agents off or removing a folder there applies at once and narrows the approval; turning
 * them on or adding a folder waits for approval in Settings → Agents. The first read seeds it from
 * config.jsonc, whose values were already in effect, so nobody sees a change or a prompt.
 */
export class AgentAccess {
  private store: DocumentStore<Approval>;
  private approval?: Approval;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(
    dataPath: string,
    private requested: () => RequestedAgentAccess | undefined,
  ) {
    this.store = new DocumentStore(path.join(dataPath, 'agent-access-v1.json'), (value) =>
      approvalSchema.parse(value),
    );
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const task = this.writes.catch(() => {}).then(work);
    this.writes = task;
    return task;
  }
  /** Nothing while there is no approval and nothing to seed it from (config.jsonc unreadable). */
  private async approved(): Promise<Approval | undefined> {
    if (this.approval) return this.approval;
    const stored = await this.store.load();
    if (stored) return (this.approval = stored);
    const requested = this.requested();
    if (!requested) return undefined;
    const seeded: Approval = {
      version: 1,
      enabled: requested.enabled,
      roots: [...new Set(await Promise.all(requested.roots.map(canonical)))],
    };
    await this.store.save(seeded);
    return (this.approval ??= seeded);
  }
  /** What the shared connection may do: nothing without an approval to read. */
  async capabilities(): Promise<AgentCapability[]> {
    const approval = await this.approved().catch(() => undefined);
    return approval ? [...(approval.capabilities ?? agentCapabilities)] : [];
  }
  /** What agents may use now, and what config.jsonc asks for beyond it. */
  async state(): Promise<AgentAccessState> {
    const requested = this.requested();
    // an approval that cannot be read approves nothing; a new approval replaces it
    const approval = await this.approved().catch(() => undefined);
    const named = await Promise.all(
      (requested?.roots ?? []).map(async (root) => ({ root, actual: await canonical(root) })),
    );
    const approvedRoots = new Set(approval?.roots ?? []);
    const namedRoots = new Set(named.map(({ actual }) => actual));
    return {
      enabled: !!requested?.enabled && !!approval?.enabled,
      roots: named.filter(({ actual }) => approvedRoots.has(actual)).map(({ root }) => root),
      protectedRoots: [
        ...named.map(({ root }) => root),
        ...(approval?.roots ?? []).filter((root) => !namedRoots.has(root)),
      ],
      pending: {
        enable: !!requested?.enabled && !approval?.enabled,
        roots: named.filter(({ actual }) => !approvedRoots.has(actual)).map(({ root }) => root),
      },
      capabilities: approval ? [...(approval.capabilities ?? agentCapabilities)] : [],
    };
  }
  /** config.jsonc turned agents off or removed folders: the approval follows, so turning them
   * back on there is a request again. An unreadable config.jsonc narrows nothing. */
  narrow(): Promise<void> {
    return this.serial(async () => {
      const requested = this.requested();
      const approval = requested && (await this.approved().catch(() => undefined));
      if (!requested || !approval) return;
      const named = new Set(await Promise.all(requested.roots.map(canonical)));
      const next: Approval = {
        ...approval,
        enabled: approval.enabled && requested.enabled,
        roots: approval.roots.filter((root) => named.has(root)),
      };
      if (next.enabled === approval.enabled && next.roots.length === approval.roots.length) return;
      await this.store.save(next);
      this.approval = next;
    });
  }
  /** The person's own change in Settings → Agents; the desktop confirms a widening natively first. */
  approve(change: {
    enabled?: boolean;
    add?: readonly string[];
    remove?: readonly string[];
    capabilities?: readonly AgentCapability[];
  }): Promise<void> {
    return this.serial(async () => {
      const approval = (await this.approved().catch(() => undefined)) ?? {
        version: 1,
        enabled: false,
        roots: [],
      };
      const add = await Promise.all((change.add ?? []).map(canonical));
      const remove = new Set(await Promise.all((change.remove ?? []).map(canonical)));
      const next: Approval = {
        version: 1,
        enabled: change.enabled ?? approval.enabled,
        roots: [...new Set([...approval.roots, ...add])].filter((root) => !remove.has(root)),
        ...(change.capabilities
          ? {
              capabilities: agentCapabilities.filter((item) => change.capabilities!.includes(item)),
            }
          : approval.capabilities
            ? { capabilities: approval.capabilities }
            : {}),
      };
      await this.store.save(next);
      this.approval = next;
    });
  }
}
