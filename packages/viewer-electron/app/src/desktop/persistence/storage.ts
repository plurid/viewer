import { syncParentDirectory } from './directory-sync';
import {
  compilePresentationValues,
  presentationValuesSchema,
} from '../../domain/preferences/presentation/profile-fields';
import { tileLayouts, tileSplitSchema } from '../../domain/workspaces/tiling';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { gitActionKinds } from '../../domain/comparison/git-actions';
import { CURRENT_STATE_VERSION, type SavedState } from '../../domain/contracts';
import { collectionSchema, basketItemSchema } from '../../domain/workspaces/collections';
import { evidenceNavigationSchema } from '../../domain/files/inspection';
import {
  folderOverrideSchema,
  layoutSchema,
  projectDefinitionSchema,
  previewValuesSchema,
} from '../../domain/workspaces/project';
import {
  migratePlaneNavigation,
  needsNavigationMigration,
  normalizePaneSidebar,
  normalizePreferences,
} from '../../domain/preferences/ui';
import { discardOwnTemporaryFile } from '../operations/removal';
import { localPath, id } from '../schemas';
import { diffModes, diffSourceSchema } from '../../domain/comparison/diff';
import { journalFilterSchema } from '../../domain/journal/events';
import { taskAreaSchema } from '../../domain/workspaces/tasks';

const pane = z.discriminatedUnion('type', [
  z
    .object({
      id,
      type: z.literal('task'),
      path: localPath,
      areaID: z.uuid(),
      title: z.string().max(100),
    })
    .strict(),
  z.object({ id, type: z.literal('receipt'), path: localPath, receiptID: z.uuid() }).strict(),
  z
    .object({
      id,
      type: z.literal('note'),
      path: localPath,
      documentID: z.uuid(),
      title: z.string().max(255),
    })
    .strict(),
  z
    .object({
      id,
      type: z.literal('journal'),
      path: localPath,
      filter: journalFilterSchema,
      savedFilters: z
        .array(
          z
            .object({
              id: z.uuid(),
              name: z.string().trim().min(1).max(80),
              filter: journalFilterSchema,
            })
            .strict(),
        )
        .max(20)
        .optional(),
    })
    .strict(),
  z
    .object({
      id,
      type: z.literal('server'),
      runtimeID: id.optional(),
      path: localPath,
      sourceIdentity: z
        .string()
        .max(100)
        .regex(/^\d+:\d+$/)
        .optional(),
    })
    .strict(),
  z.object({ id, type: z.literal('git-changes'), path: localPath }).strict(),
  z.object({ id, type: z.literal('media'), path: localPath, draftID: z.uuid() }).strict(),
  z
    .object({
      id,
      type: z.literal('browser'),
      path: localPath,
      url: z
        .string()
        .max(8192)
        .url()
        .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol)),
      title: z.string().max(1000).optional(),
      serverRuntimeID: id.optional(),
      serverPath: z.string().max(8192).optional(),
    })
    .strict(),
  z.object({ id, type: z.literal('chat'), path: localPath, conversationID: z.uuid() }).strict(),
  z
    .object({
      id,
      type: z.literal('diff'),
      path: localPath,
      left: diffSourceSchema,
      right: diffSourceSchema,
      mode: z.enum(diffModes).optional(),
      bufferID: z.uuid().optional(),
    })
    .strict(),
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
    taskSessionID: id.optional(),
    startOnOpen: z.boolean().optional(),
    gitAction: z.enum(gitActionKinds).optional(),
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
    exploded: id.optional(),
    pair: id.optional(),
    pairSync: z.boolean().optional(),
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
      z.literal(5),
      z.literal(6),
      z.literal(7),
      z.literal(8),
      z.literal(9),
      z.literal(CURRENT_STATE_VERSION),
    ]),
    previewStates: z.record(id, previewValuesSchema).optional(),
    openWindows: z.array(id).max(30).optional(),
    preferencesRevision: z.number().int().min(0).optional(),
    workspaces: z
      .array(
        z.object({
          id,
          name: z.string().min(1).max(100),
          panes: z.array(pane).max(200),
          roots: z.array(id).max(200),
          taskAreas: z.array(taskAreaSchema).max(50).optional(),
          activePane: id.optional(),
          arrangement: z.record(z.string().max(300), z.string().max(4 * 1024 * 1024)),
          collections: z.array(collectionSchema).max(200).optional(),
          basket: z.array(basketItemSchema).max(10000).optional(),
          overrides: presentationValuesSchema
            .transform((values) => compilePresentationValues(values).values)
            .optional(),
          profileID: id.optional(),
          tiling: z
            .object({
              panes: z.array(id).min(1).max(30),
              layout: z.enum(tileLayouts),
              main: z.number().min(0.2).max(0.8),
              tree: tileSplitSchema.optional(),
            })
            .strict()
            .optional(),
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
    profile: z
      .object({
        id: z.string().max(100),
        previous: z.record(z.string().max(200), z.json()),
      })
      .strict()
      .optional(),
    windowProfiles: z
      .record(
        id,
        z
          .object({
            id: z.string().max(100),
            previous: z.record(z.string().max(200), z.json()),
          })
          .strict(),
      )
      .refine((profiles) => Object.keys(profiles).length <= 30)
      .optional(),
    visits: z
      .record(
        localPath,
        z.object({ count: z.number().int().min(0).max(1e9), last: z.number().min(0) }).strict(),
      )
      .refine((visits) => Object.keys(visits).length <= 500)
      .optional(),
    lineHistory: z.array(z.string().max(500)).max(200).optional(),
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
  private async preserve(bytes: string | Uint8Array, suffix: string): Promise<void> {
    const backup = await open(this.file + suffix + '-' + randomUUID() + '.bak', 'wx', 0o600);
    try {
      await backup.writeFile(bytes);
      await backup.sync();
    } finally {
      await backup.close();
    }
    await syncParentDirectory(this.file);
  }
  async load(): Promise<{ state: SavedState | null; recovery?: string }> {
    await this.writes.catch(() => undefined);
    let bytes: Buffer;
    let original: unknown;
    let state: SavedState;
    try {
      bytes = await readFile(this.file);
      if (bytes.length > 32 * 1024 * 1024) throw new Error('State exceeds the size limit.');
      original = JSON.parse(bytes.toString('utf8'));
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
    if (needsNavigationMigration(original))
      await this.preserve(bytes, '.before-plane-navigation-v3-' + Date.now());
    if (state.version < 4) await this.preserve(bytes, '.before-projects-v4');
    else if (state.version < 6) await this.preserve(bytes, '.before-planes-v6');
    if (state.version < 7) await this.preserve(bytes, '.before-profile-overlays-v7');
    if (state.version < 8) await this.preserve(bytes, '.before-spatial-workbench-v8');
    if (state.version < 9) await this.preserve(bytes, '.before-notes-v9');
    if (state.version < 10) await this.preserve(bytes, '.before-task-areas-v10');
    if (state.version < CURRENT_STATE_VERSION) state = { ...state, version: CURRENT_STATE_VERSION };
    return { state };
  }
  save(input: SavedState): Promise<void> {
    if (this.retained)
      return Promise.reject(
        Object.assign(
          new Error(
            'The saved workspace could not be moved aside and remains protected at ' +
              this.retained +
              '. This window has not been saved.',
          ),
          { code: 'STATE_RETAINED' },
        ),
      );
    const state = stateSchema.parse(input);
    const text = JSON.stringify(state);
    if (text.length > 32 * 1024 * 1024) throw new Error('Workspace state exceeds the size limit.');
    const write = this.writes
      .catch(() => undefined)
      .then(async () => {
        await mkdir(path.dirname(this.file), { recursive: true });
        if (state.version === 2) {
          const old = await readFile(this.file).catch((error) => {
            if (error.code === 'ENOENT') return null;
            throw error;
          });
          if (old && JSON.parse(old.toString('utf8')).version === 1) {
            await this.preserve(old, '.before-services-v2');
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
          await syncParentDirectory(this.file);
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
