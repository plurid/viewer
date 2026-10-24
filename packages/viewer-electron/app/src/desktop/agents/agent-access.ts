import { constants } from 'node:fs';
import { lstat, open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DocumentStore } from '../persistence/document-store';
import { absolute } from '../files/filesystem';
import {
  agentCapabilities,
  type AgentAccessState,
  type AgentCapability,
} from '../../domain/agents/clients';
import {
  agentAuthoritySchema,
  defaultAgentAuthority,
  legacyAgentAuthoritySchema,
  type AgentAccessChange,
  type AgentAccessReview,
  type AgentAuthority,
} from './access-model';

export type { AgentAccessChange, AgentAccessReview } from './access-model';

/** What config.jsonc asks for (`settings.agents`), or nothing while it cannot be read. */
export interface RequestedAgentAccess {
  enabled: boolean;
  roots: readonly string[];
  revision?: number;
}
const canonical = (root: string) =>
  realpath(absolute(root)).catch(() => path.resolve(absolute(root)));

interface CapturedReview {
  generation: number;
  fingerprint: string;
}

/** Private version-2 consent is authoritative. Configuration can only narrow it. */
export class AgentAccess {
  private store: DocumentStore<AgentAuthority>;
  private legacyStore: DocumentStore<ReturnType<typeof legacyAgentAuthoritySchema.parse>>;
  private approval?: AgentAuthority;
  private loading?: Promise<AgentAuthority>;
  private legacyRoots: string[] = [];
  private unreadable = false;
  private generation = 0;
  private reviews = new WeakMap<AgentAccessReview, CapturedReview>();
  private writes: Promise<unknown> = Promise.resolve();
  constructor(
    dataPath: string,
    private requested: () => RequestedAgentAccess | undefined,
  ) {
    this.store = new DocumentStore(path.join(dataPath, 'agent-access-v2.json'), (value) =>
      agentAuthoritySchema.parse(value),
    );
    this.legacyStore = new DocumentStore(path.join(dataPath, 'agent-access-v1.json'), (value) =>
      legacyAgentAuthoritySchema.parse(value),
    );
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const task = this.writes.catch(() => {}).then(work);
    this.writes = task;
    return task;
  }
  private async load(): Promise<AgentAuthority> {
    let legacyNeedsReview = false;
    try {
      const legacy = await this.legacyStore.load();
      this.legacyRoots = legacy?.roots ?? [];
      legacyNeedsReview = !!(
        legacy?.enabled ||
        legacy?.roots.length ||
        legacy?.capabilities?.length
      );
    } catch {
      legacyNeedsReview = true;
    }
    try {
      this.approval = (await this.store.load()) ?? defaultAgentAuthority(legacyNeedsReview);
    } catch {
      this.unreadable = true;
      this.approval = defaultAgentAuthority(true);
    }
    return this.approval;
  }

  private approved(): Promise<AgentAuthority> {
    return (this.loading ??= this.load());
  }

  /** Keep unreadable authority bytes before an explicit review replaces them. */
  private async preserveUnreadable(): Promise<void> {
    if (!this.unreadable) return;
    const source = await open(
      this.store.file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const before = await source.stat();
      if (!before.isFile() || before.size > 16000000)
        throw new Error('The private agent approval is not a bounded regular file. It was kept.');
      const bytes = await source.readFile();
      const after = await source.stat();
      const current = await lstat(this.store.file);
      if (
        bytes.length !== before.size ||
        before.ctimeMs !== after.ctimeMs ||
        before.mtimeMs !== after.mtimeMs ||
        current.dev !== before.dev ||
        current.ino !== before.ino
      )
        throw new Error('The private agent approval changed. Review it again.');
      const backup = await open(
        this.store.file + '.before-review-' + randomUUID() + '.bak',
        'wx',
        0o600,
      );
      try {
        await backup.writeFile(bytes);
        await backup.sync();
      } finally {
        await backup.close();
      }
    } finally {
      await source.close();
    }
  }

  private async save(next: AgentAuthority): Promise<void> {
    await this.preserveUnreadable();
    await this.store.save(next);
    this.approval = next;
    this.loading = Promise.resolve(next);
    this.unreadable = false;
    this.generation++;
  }
  /** What the shared connection may do: nothing without an approval to read. */
  async capabilities(): Promise<AgentCapability[]> {
    const approval = await this.approved();
    return [...approval.capabilities];
  }
  /** What agents may use now, and what config.jsonc asks for beyond it. */
  async state(): Promise<AgentAccessState> {
    const requested = this.requested();
    // an approval that cannot be read approves nothing; a new approval replaces it
    const approval = await this.approved();
    const named = await Promise.all(
      (requested?.roots ?? []).map(async (root) => ({ root, actual: await canonical(root) })),
    );
    const approvedRoots = new Set(approval.roots);
    const namedRoots = new Set(named.map(({ actual }) => actual));
    return {
      enabled: !!requested?.enabled && approval.enabled,
      roots: named.filter(({ actual }) => approvedRoots.has(actual)).map(({ root }) => root),
      protectedRoots: [
        ...named.map(({ root }) => root),
        ...[...approval.roots, ...this.legacyRoots].filter((root) => !namedRoots.has(root)),
      ],
      pending: {
        enable: !!requested?.enabled && !approval.enabled,
        roots: named.filter(({ actual }) => !approvedRoots.has(actual)).map(({ root }) => root),
      },
      capabilities: [...approval.capabilities],
      requiresReapproval: approval.requiresReapproval,
    };
  }
  /** config.jsonc turned agents off or removed folders: the approval follows, so turning them
   * back on there is a request again. An unreadable config.jsonc narrows nothing. */
  narrow(): Promise<void> {
    return this.serial(async () => {
      const requested = this.requested();
      const approval = requested && (await this.approved());
      if (!requested || !approval) return;
      const named = new Set(await Promise.all(requested.roots.map(canonical)));
      const next: AgentAuthority = {
        ...approval,
        enabled: approval.enabled && requested.enabled,
        roots: approval.roots.filter((root) => named.has(root)),
      };
      if (next.enabled === approval.enabled && next.roots.length === approval.roots.length) return;
      await this.save(next);
    });
  }
  private async reviewState(change: AgentAccessChange) {
    const requested = this.requested();
    if (!requested) throw new Error('Read a valid configuration before allowing agent access.');
    const snapshot = {
      revision: requested.revision,
      enabled: requested.enabled,
      roots: [...requested.roots],
    };
    const paths = [...new Set([...snapshot.roots, ...(change.add ?? [])])].sort();
    const roots = await Promise.all(
      paths.map(async (file) => {
        const actual = await canonical(file);
        const info = await lstat(actual).catch((error) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
          throw error;
        });
        return {
          path: absolute(file),
          canonical: actual,
          identity: info ? `${info.dev}:${info.ino}` : undefined,
        };
      }),
    );
    const added = new Set((change.add ?? []).map(absolute));
    for (const root of roots) {
      if (!added.has(root.path)) continue;
      if (!(await stat(root.canonical)).isDirectory())
        throw new Error('Choose a readable folder for agent access.');
    }
    const current = this.requested();
    if (
      !current ||
      current.revision !== snapshot.revision ||
      current.enabled !== snapshot.enabled ||
      JSON.stringify(current.roots) !== JSON.stringify(snapshot.roots)
    )
      throw new Error('The requested agent access changed. Review it again.');
    return { snapshot, roots, fingerprint: JSON.stringify({ snapshot, roots, change }) };
  }

  /** The desktop captures this before presenting the native confirmation. */
  async captureReview(change: AgentAccessChange): Promise<AgentAccessReview> {
    const approval = await this.approved();
    const generation = this.generation;
    const state = await this.reviewState(change);
    const review: AgentAccessReview = Object.freeze({
      requestedRevision: state.snapshot.revision,
      roots: Object.freeze(state.roots.map((root) => Object.freeze(root))),
      capabilities: Object.freeze([...(change.capabilities ?? approval.capabilities)]),
    });
    this.reviews.set(review, { generation, fingerprint: state.fingerprint });
    return review;
  }

  /** Positive authority changes need a live, unchanged review from the native confirmation. */
  approve(change: AgentAccessChange, review?: AgentAccessReview): Promise<void> {
    return this.serial(async () => {
      const approval = await this.approved();
      const capabilities = change.capabilities
        ? agentCapabilities.filter((item) => change.capabilities!.includes(item))
        : [...approval.capabilities];
      const needsReview =
        change.enabled === true ||
        !!change.add?.length ||
        capabilities.some((capability) => !approval.capabilities.includes(capability));
      let add: string[] = [];
      if (needsReview || review) {
        const captured = review && this.reviews.get(review);
        if (review) this.reviews.delete(review);
        if (!captured || captured.generation !== this.generation)
          throw new Error(
            'Review this agent access in the native confirmation before allowing it.',
          );
        const current = await this.reviewState(change);
        if (captured.fingerprint !== current.fingerprint)
          throw new Error('The requested agent access changed. Review it again.');
        add = (change.add ?? []).map((file) => {
          const root = current.roots.find((root) => root.path === absolute(file));
          if (!root) throw new Error('The reviewed folder is unavailable. Review it again.');
          return root.canonical;
        });
      }
      const remove = new Set(await Promise.all((change.remove ?? []).map(canonical)));
      const next: AgentAuthority = {
        version: 2,
        enabled: change.enabled ?? approval.enabled,
        roots: [...new Set([...approval.roots, ...add])].filter((root) => !remove.has(root)),
        capabilities,
        requiresReapproval: change.enabled === true ? false : approval.requiresReapproval,
      };
      await this.save(agentAuthoritySchema.parse(next));
    });
  }
}
