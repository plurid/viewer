import { mkdir, open, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CURRENT_STATE_VERSION, type SavedState } from '../domain/contracts';
import { collectionSchema, basketItemSchema } from '../domain/collections';
import { evidenceNavigationSchema } from '../domain/inspection';
import {
  folderOverrideSchema,
  layoutSchema,
  projectDefinitionSchema,
  previewValuesSchema,
} from '../domain/project';
import {
  migratePlaneNavigation,
  needsNavigationMigration,
  normalizePaneSidebar,
  normalizePreferences,
} from '../domain/preferences';
import { discardOwnTemporaryFile } from './removal';
import { localPath, id } from './schemas';

const pane = z.discriminatedUnion('type', [
  z.object({ id, type: z.literal('collection'), path: localPath, collectionID: z.uuid() }),
  z.object({
    id,
    type: z.literal('scratch'),
    path: localPath,
    bufferID: z.uuid(),
    language: z.string().max(40).optional(),
    title: z.string().max(255).optional(),
  }),
  z.object({
    id,
    type: z.literal('terminal'),
    path: localPath,
    profileID: id,
    startOnOpen: z.boolean().optional(),
  }),
  z.object({
    id,
    type: z.literal('search'),
    path: localPath,
    query: z.string().max(300),
    name: z.string().max(100),
    allLocations: z.boolean(),
    recursive: z.boolean().optional(),
    content: z.boolean().optional(),
  }),
  z.object({
    id,
    type: z.literal('folder'),
    path: localPath,
    mode: z.enum(['list', 'grid', 'columns', 'gallery', 'map']),
    sort: z.enum(['name', 'modified', 'created', 'size', 'kind', 'extension']),
    descending: z.boolean(),
    showHidden: z.boolean(),
    history: z.array(localPath).max(200),
    historyIndex: z.number().int().min(0).max(199),
    sidebar: z.unknown().optional().transform(normalizePaneSidebar),
  }),
  z.object({
    id,
    type: z.literal('preview'),
    path: localPath,
    evidence: evidenceNavigationSchema.optional(),
    bufferID: z.uuid().optional(),
    keepSeparate: z
      .unknown()
      .optional()
      .transform((value) => value === true || undefined),
  }),
]);
const savedStateSchema = z
  .object({
    version: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(CURRENT_STATE_VERSION),
    ]),
    previewStates: z.record(id, previewValuesSchema).optional(),
    preferencesRevision: z.number().int().min(0).optional(),
    workspaces: z
      .array(
        z.object({
          id,
          name: z.string().min(1).max(100),
          panes: z.array(pane).max(200),
          roots: z.array(id).max(200),
          activePane: id.optional(),
          arrangement: z.record(z.string().max(300), z.string().max(4 * 1024 * 1024)),
          collections: z.array(collectionSchema).max(200).optional(),
          basket: z.array(basketItemSchema).max(10000).optional(),
          spaceColor: z
            .string()
            .regex(/^#[0-9a-f]{6}$/)
            .optional(),
          layout: layoutSchema.optional(),
          epoch: z.number().int().min(0).optional(),
          project: z
            .object({
              file: localPath,
              root: localPath,
              revision: z.string().max(200),
              definition: projectDefinitionSchema,
              bindings: z.record(id, localPath),
              folders: z.record(localPath, folderOverrideSchema),
              dirty: z.boolean(),
            })
            .strict()
            .optional(),
        }),
      )
      .min(1)
      .max(30),
    activeWorkspace: id,
    favorites: z.array(z.object({ name: z.string().max(200), path: localPath })).max(200),
    recents: z.array(localPath).max(50),
    look: z.enum(['dark', 'light']),
    ui: z.unknown().optional().transform(normalizePreferences),
  })
  .refine(
    (state) => state.workspaces.some((workspace) => workspace.id === state.activeWorkspace),
    'Active workspace is missing.',
  )
  .refine(
    (state) =>
      new Set(state.workspaces.map((workspace) => workspace.id)).size === state.workspaces.length,
    'Workspace IDs must be unique.',
  )
  .refine(
    (state) =>
      state.workspaces.every(
        (workspace) =>
          new Set(workspace.panes.map((p) => p.id)).size === workspace.panes.length &&
          new Set(workspace.roots).size === workspace.roots.length &&
          workspace.roots.every((root) => workspace.panes.some((p) => p.id === root)) &&
          (!workspace.activePane || workspace.panes.some((p) => p.id === workspace.activePane)),
      ),
    'Invalid workspace pane references.',
  )
  .refine(
    (state) =>
      state.workspaces.every((workspace) =>
        workspace.panes.every(
          (pane) =>
            pane.type !== 'folder' ||
            (pane.history.length > 0 &&
              pane.historyIndex < pane.history.length &&
              pane.history[pane.historyIndex] === pane.path),
        ),
      ),
    'Invalid folder navigation history.',
  );
export const stateSchema = z.preprocess(migratePlaneNavigation, savedStateSchema);
/** Keeps every workspace that is valid on its own when another one is not, so one
 * damaged pane cannot discard all saved workspaces. */
export function salvageState(
  original: unknown,
): { state: SavedState; dropped: number } | undefined {
  if (!original || typeof original !== 'object') return;
  const saved = original as { workspaces?: unknown; activeWorkspace?: unknown };
  if (!Array.isArray(saved.workspaces)) return;
  const kept = saved.workspaces.filter(
    (workspace) =>
      !!workspace &&
      typeof workspace === 'object' &&
      stateSchema.safeParse({
        ...saved,
        workspaces: [workspace],
        activeWorkspace: (workspace as { id?: unknown }).id,
      }).success,
  ) as { id: string }[];
  const [first] = kept;
  if (!first) return;
  const parsed = stateSchema.safeParse({
    ...saved,
    workspaces: kept,
    activeWorkspace: kept.some((workspace) => workspace.id === saved.activeWorkspace)
      ? saved.activeWorkspace
      : first.id,
  });
  if (!parsed.success) return;
  return {
    state: { ...parsed.data, version: CURRENT_STATE_VERSION },
    dropped: saved.workspaces.length - kept.length,
  };
}
export class Storage {
  private writes: Promise<void> = Promise.resolve();
  /** Set when an unreadable state file could not be moved aside; it is never written over. */
  private retained?: string;
  constructor(readonly file: string) {}
  async load(): Promise<{ state: SavedState | null; recovery?: string }> {
    await this.writes.catch(() => undefined);
    let text: string;
    let original: unknown;
    let state: SavedState;
    try {
      text = await readFile(this.file, 'utf8');
      if (text.length > 32 * 1024 * 1024) throw new Error('State exceeds the size limit.');
      original = JSON.parse(text);
      state = stateSchema.parse(original);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: null };
      const salvaged = error instanceof z.ZodError ? salvageState(original) : undefined;
      const backup = `${this.file}.unreadable-${Date.now()}`;
      try {
        await rename(this.file, backup);
      } catch {
        this.retained = this.file;
        return {
          state: salvaged?.state ?? null,
          recovery: `Saved workspace could not be loaded or moved aside, so it was left at ${this.file}. Layout changes in this session will not be saved over it.`,
        };
      }
      if (salvaged)
        return {
          state: salvaged.state,
          recovery: `${salvaged.dropped} saved ${salvaged.dropped === 1 ? 'workspace was' : 'workspaces were'} damaged and could not be opened; the others were restored. The original file was kept at ${backup}.`,
        };
      return {
        state: null,
        recovery: `Saved workspace could not be loaded. A backup was kept at ${backup}.`,
      };
    }
    if (needsNavigationMigration(original)) {
      // A failed backup must never enter corrupt-state recovery or replace a valid layout.
      const backup = `${this.file}.before-plane-navigation-v3-${Date.now()}-${randomUUID()}.bak`;
      const handle = await open(backup, 'wx', 0o600);
      try {
        await handle.writeFile(text);
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    if (state.version < 4) {
      const backup = await open(
        this.file + '.before-projects-v4-' + randomUUID() + '.bak',
        'wx',
        0o600,
      );
      try {
        await backup.writeFile(text);
        await backup.sync();
      } finally {
        await backup.close();
      }
    } else if (state.version < CURRENT_STATE_VERSION) {
      // An older Viewer sets a version 5 file aside, unread: this copy is what it can open.
      const backup = await open(
        this.file + '.before-scratch-v5-' + randomUUID() + '.bak',
        'wx',
        0o600,
      );
      try {
        await backup.writeFile(text);
        await backup.sync();
      } finally {
        await backup.close();
      }
    }
    if (state.version < CURRENT_STATE_VERSION) state = { ...state, version: CURRENT_STATE_VERSION };
    return { state };
  }
  save(input: SavedState): Promise<void> {
    // The load notice already said this session's layout is not saved over the kept file.
    if (this.retained) return Promise.resolve();
    const state = stateSchema.parse(input);
    const text = JSON.stringify(state);
    if (text.length > 32 * 1024 * 1024) throw new Error('Workspace state exceeds the size limit.');
    const write = this.writes
      .catch(() => undefined)
      .then(async () => {
        await mkdir(path.dirname(this.file), { recursive: true });
        if (state.version === 2) {
          const old = await readFile(this.file, 'utf8').catch((error) => {
            if (error.code === 'ENOENT') return '';
            throw error;
          });
          if (old && JSON.parse(old).version === 1) {
            const backup = await open(
              this.file + '.before-services-v2-' + randomUUID() + '.bak',
              'wx',
              0o600,
            );
            try {
              await backup.writeFile(old);
              await backup.sync();
            } finally {
              await backup.close();
            }
          }
        }
        const temporary = `${this.file}.${randomUUID()}.tmp`;
        try {
          const handle = await open(temporary, 'wx', 0o600);
          try {
            await handle.writeFile(text);
            await handle.sync();
          } finally {
            await handle.close();
          }
          await rename(temporary, this.file);
        } finally {
          await discardOwnTemporaryFile(temporary);
        }
      });
    this.writes = write;
    return write;
  }
  flush(): Promise<void> {
    return this.writes;
  }
}
