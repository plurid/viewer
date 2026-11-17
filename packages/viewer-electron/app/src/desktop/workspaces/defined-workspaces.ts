import { rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { SavedState, Workspace } from '../../domain/contracts';
import type { RememberedWorkspace } from '../../domain/workspaces/definitions/schema';
import { definitionKeySchema } from '../../domain/workspaces/definitions/schema';
import { fileViewSchema } from '../../domain/previews/history';
import { previewValuesSchema } from '../../domain/workspaces/project';
import { DocumentStore } from '../persistence/document-store';
import { workspaceSchema } from '../persistence/storage';

export const rememberedWorkspaceLimit = 100;
export const rememberedWorkspaceBytes = 16_000_000;

const closedSchema = z
  .object({
    key: definitionKeySchema,
    at: z.number().finite().nonnegative(),
    basis: z.string().regex(/^[a-f0-9]{64}$/),
    workspace: workspaceSchema,
    previewStates: z.record(z.string().max(300), previewValuesSchema),
    previewHistory: z.array(fileViewSchema).max(50),
  })
  .strict()
  .refine(
    (entry) =>
      entry.workspace.definition?.key === entry.key &&
      entry.workspace.definition.basis === entry.basis,
  );

const memorySchema = z
  .object({
    version: z.literal(1),
    closed: z.array(closedSchema).max(rememberedWorkspaceLimit),
    opened: z
      .record(definitionKeySchema, z.number().finite().nonnegative())
      .refine((opened) => Object.keys(opened).length <= 500),
  })
  .strict()
  .refine((value) => new Set(value.closed.map((entry) => entry.key)).size === value.closed.length);
type WorkspaceMemory = z.infer<typeof memorySchema>;

function rememberedEntry(
  workspace: Workspace,
  state: Pick<SavedState, 'previewStates' | 'previewHistory'>,
) {
  const link = workspace.definition;
  if (!link) throw new Error('Only a workspace with a definition can remember its planes.');
  return closedSchema.parse({
    key: link.key,
    basis: link.basis,
    at: Date.now(),
    workspace,
    previewStates: Object.fromEntries(
      Object.entries(state.previewStates ?? {}).filter(([id]) => id.startsWith(workspace.id + ':')),
    ),
    previewHistory: state.previewHistory?.[workspace.id] ?? [],
  });
}

export class DefinedWorkspaces {
  readonly store: DocumentStore<WorkspaceMemory>;
  private current: WorkspaceMemory = { version: 1, closed: [], opened: {} };
  private loading?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  private retained = false;
  recovery?: string;

  constructor(directory: string) {
    this.store = new DocumentStore(path.join(directory, 'defined-workspaces-v1.json'), (value) =>
      memorySchema.parse(value),
    );
  }
  load(): Promise<void> {
    return (this.loading ??= (async () => {
      try {
        this.current = (await this.store.load()) ?? this.current;
      } catch {
        const kept = this.store.file + '.unreadable-' + randomUUID();
        try {
          await rename(this.store.file, kept);
          this.recovery =
            'Unreadable remembered planes were kept aside. Definitions can still open fresh.';
        } catch {
          this.retained = true;
          this.recovery =
            'Remembered planes could not be read or kept aside. This session will not overwrite them.';
        }
      }
    })());
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  get(key: string): RememberedWorkspace | undefined {
    const entry = this.current.closed.find((item) => item.key === key);
    return entry && structuredClone(entry);
  }
  summary(key: string) {
    const entry = this.current.closed.find((item) => item.key === key);
    return entry && { at: entry.at, basis: entry.basis, planes: entry.workspace.panes.length };
  }
  openedAt(key: string): number | undefined {
    return Object.hasOwn(this.current.opened, key) ? this.current.opened[key] : undefined;
  }
  bufferIDs(): string[] {
    return [
      ...new Set(
        this.current.closed.flatMap((entry) =>
          entry.workspace.panes.flatMap((pane) =>
            pane.type === 'scratch' ||
            ((pane.type === 'preview' || pane.type === 'diff') && pane.bufferID)
              ? [pane.bufferID!]
              : [],
          ),
        ),
      ),
    ];
  }
  problem(
    workspace: Workspace,
    state: Pick<SavedState, 'previewStates' | 'previewHistory'>,
  ): string | undefined {
    if (this.retained) return 'its unreadable memory file remains protected';
    const entry = rememberedEntry(workspace, state);
    if (
      Buffer.byteLength(
        JSON.stringify({ version: 1, closed: [entry], opened: this.current.opened }),
      ) > rememberedWorkspaceBytes
    )
      return 'this workspace alone exceeds the 16 MB memory limit';
    return undefined;
  }
  private change(
    change: (current: WorkspaceMemory) => WorkspaceMemory,
    keep?: string,
  ): Promise<void> {
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        await this.load();
        if (this.retained)
          throw new Error(
            'Remembered planes remain protected because their file could not be read.',
          );
        const next = change(structuredClone(this.current));
        next.closed.sort((a, b) => b.at - a.at);
        const protectedEntry = keep && next.closed.find((entry) => entry.key === keep);
        next.closed = next.closed.slice(0, rememberedWorkspaceLimit);
        if (protectedEntry && !next.closed.includes(protectedEntry)) {
          next.closed.pop();
          next.closed.push(protectedEntry);
          next.closed.sort((a, b) => b.at - a.at);
        }
        next.opened = Object.fromEntries(
          Object.entries(next.opened)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 500),
        );
        let bytes = Buffer.byteLength(JSON.stringify(next));
        while (next.closed.length > 1 && bytes > rememberedWorkspaceBytes) {
          const index = next.closed.findLastIndex((entry) => entry.key !== keep);
          const [removed] = next.closed.splice(index, 1);
          bytes -= Buffer.byteLength(JSON.stringify(removed)) + 1;
        }
        if (bytes > rememberedWorkspaceBytes)
          throw new Error('This workspace exceeds the 16 MB memory limit.');
        await this.store.save(next);
        this.current = next;
        for (const listener of this.listeners) listener();
      });
    this.queue = task;
    return task;
  }
  remember(
    workspace: Workspace,
    state: Pick<SavedState, 'previewStates' | 'previewHistory'>,
  ): Promise<void> {
    const entry = rememberedEntry(workspace, state);
    const problem = this.problem(workspace, state);
    if (problem)
      return Promise.reject(new Error('Viewer cannot remember its planes: ' + problem + '.'));
    return this.change(
      (current) => ({
        ...current,
        closed: [entry, ...current.closed.filter((item) => item.key !== entry.key)],
      }),
      entry.key,
    );
  }
  async opened(key: string): Promise<void> {
    definitionKeySchema.parse(key);
    await this.load();
    if (this.retained) {
      this.current.opened = Object.fromEntries(
        Object.entries({ ...this.current.opened, [key]: Date.now() })
          .sort(([, a], [, b]) => b - a)
          .slice(0, 500),
      );
      for (const listener of this.listeners) listener();
      return;
    }
    return this.change((current) => ({
      ...current,
      opened: { ...current.opened, [key]: Date.now() },
    }));
  }
  forget(key: string): Promise<void> {
    return this.change((current) => ({
      ...current,
      closed: current.closed.filter((item) => item.key !== key),
    }));
  }
  async close(): Promise<void> {
    await this.queue.catch(() => {});
    await this.store.flush().catch(() => {});
  }
}
