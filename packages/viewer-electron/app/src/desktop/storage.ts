import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SavedState } from '../domain/contracts';
import {
  migratePlaneNavigation,
  needsNavigationMigration,
  normalizePaneSidebar,
  normalizePreferences,
} from '../domain/preferences';

const localPath = z
  .string()
  .min(1)
  .max(32768)
  .refine((value) => path.isAbsolute(value) && !value.includes('\0'));
const id = z.string().min(1).max(200);
const pane = z.discriminatedUnion('type', [
  z.object({
    id,
    type: z.literal('folder'),
    path: localPath,
    mode: z.enum(['list', 'grid', 'columns', 'gallery']),
    sort: z.enum(['name', 'modified', 'size', 'kind']),
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
    keepSeparate: z
      .unknown()
      .optional()
      .transform((value) => value === true || undefined),
  }),
]);
const savedStateSchema = z
  .object({
    version: z.literal(1),
    workspaces: z
      .array(
        z.object({
          id,
          name: z.string().min(1).max(100),
          panes: z.array(pane).max(200),
          roots: z.array(id).max(200),
          activePane: id.optional(),
          arrangement: z.record(z.string().max(300), z.string().max(4 * 1024 * 1024)),
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
export class Storage {
  private writes: Promise<void> = Promise.resolve();
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
      const backup = `${this.file}.unreadable-${Date.now()}`;
      await rename(this.file, backup).catch(() => undefined);
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
    return { state };
  }
  save(input: SavedState): Promise<void> {
    const state = stateSchema.parse(input);
    const text = JSON.stringify(state);
    if (text.length > 32 * 1024 * 1024) throw new Error('Workspace state exceeds the size limit.');
    const write = this.writes
      .catch(() => undefined)
      .then(async () => {
        await mkdir(path.dirname(this.file), { recursive: true });
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
          await rm(temporary, { force: true });
        }
      });
    this.writes = write;
    return write;
  }
  flush(): Promise<void> {
    return this.writes;
  }
}
