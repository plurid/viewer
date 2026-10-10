import { clipboard, dialog, ipcMain, shell, type BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { ApiMethod, ApiResult, DesktopEvent } from '../domain/contracts';
import { absolute, entry, list } from './filesystem';
import { Operations } from './operations';
import { Resources } from './resources';
import { Search } from './search';
import { Storage, stateSchema } from './storage';
import { Watchers } from './watchers';

const localPath = z
  .string()
  .min(1)
  .max(32768)
  .refine((value) => path.isAbsolute(value) && !value.includes('\0'));
const id = z.string().min(1).max(200);
const schemas = {
  bootstrap: z.tuple([]),
  list: z.tuple([localPath]),
  stat: z.tuple([localPath]),
  chooseFolder: z.tuple([]),
  reveal: z.tuple([localPath]),
  openExternal: z.tuple([localPath]),
  watch: z.tuple([localPath, id]),
  unwatch: z.tuple([id]),
  search: z.tuple([
    z.object({ id, root: localPath, query: z.string().min(1).max(300), showHidden: z.boolean() }),
  ]),
  cancelSearch: z.tuple([id]),
  operate: z.tuple([
    z.object({
      kind: z.enum(['copy', 'move', 'duplicate', 'rename', 'mkdir', 'trash']),
      sources: z.array(localPath).max(10000),
      destination: localPath.optional(),
      name: z.string().max(255).optional(),
    }),
  ]),
  jobs: z.tuple([]),
  cancelJob: z.tuple([id]),
  resolveCollision: z.tuple([id, z.enum(['skip', 'keep-both', 'replace', 'cancel']), z.boolean()]),
  undo: z.tuple([id]),
  resource: z.tuple([localPath]),
  read: z.tuple([id, z.number().int().positive().optional()]),
  release: z.tuple([id]),
  archive: z.tuple([id]),
  archiveEntry: z.tuple([id, z.string().max(65536)]),
  save: z.tuple([stateSchema]),
  flushed: z.tuple([id]),
  clipboardWrite: z.tuple([z.array(localPath).max(10000), z.boolean()]),
  clipboardRead: z.tuple([]),
} satisfies Record<ApiMethod, z.ZodType>;
export class Desktop {
  readonly resources = new Resources();
  readonly operations: Operations;
  readonly watchers: Watchers;
  readonly search: Search;
  readonly storage: Storage;
  private ready = false;
  private openPaths: string[] = [];
  private flushes = new Map<string, () => void>();
  private fileClipboard: { paths: string[]; cut: boolean; text: string } | null = null;
  constructor(
    private window: BrowserWindow,
    dataPath: string,
    private allowedURL: (url: string) => boolean,
  ) {
    const emit = (event: DesktopEvent) => {
      if (!window.isDestroyed()) window.webContents.send('viewer:event', event);
    };
    this.operations = new Operations(
      (file) => shell.trashItem(file),
      (job) => emit({ type: 'job', job }),
    );
    this.watchers = new Watchers(emit);
    this.search = new Search((batch) => emit({ type: 'search', batch }));
    this.storage = new Storage(path.join(dataPath, 'viewer-state-v1.json'));
    ipcMain.handle(
      'viewer:request',
      async (event, method: unknown, args: unknown): Promise<ApiResult<unknown>> => {
        try {
          if (
            event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame ||
            !this.allowedURL(event.senderFrame.url)
          )
            throw new Error('Untrusted IPC sender.');
          if (typeof method !== 'string' || !Object.hasOwn(schemas, method))
            throw new Error('Unknown Viewer API method.');
          const name = method as ApiMethod;
          return {
            ok: true,
            value: await this.invoke(name, schemas[name].parse(args) as unknown[]),
          };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            code: (error as NodeJS.ErrnoException).code || 'VIEWER_ERROR',
          };
        }
      },
    );
  }
  emit(event: DesktopEvent): void {
    if (!this.window.isDestroyed()) this.window.webContents.send('viewer:event', event);
  }
  open(paths: string[]): void {
    const normalized = paths.map(absolute);
    if (this.ready) this.emit({ type: 'open', paths: normalized });
    else this.openPaths.push(...normalized);
  }
  async flush(): Promise<void> {
    if (this.ready && !this.window.isDestroyed()) {
      const token = randomUUID();
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.flushes.delete(token);
          resolve();
        }, 3000);
        this.flushes.set(token, () => {
          clearTimeout(timeout);
          this.flushes.delete(token);
          resolve();
        });
        this.emit({ type: 'flush', token });
      });
    }
    await this.storage.flush();
  }
  async dispose(): Promise<void> {
    this.ready = false;
    ipcMain.removeHandler('viewer:request');
    this.search.close();
    this.resources.clear();
    await Promise.all([this.watchers.close(), this.operations.close()]);
  }
  private async invoke(method: ApiMethod, args: unknown[]): Promise<unknown> {
    switch (method) {
      case 'bootstrap': {
        const home = os.homedir();
        const stored = await this.storage.load();
        const paths = this.openPaths.splice(0);
        this.ready = true;
        return {
          ...stored,
          home,
          platform: process.platform,
          locations: [
            { name: 'Home', path: home },
            ...['Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music'].map((name) => ({
              name,
              path: path.join(home, name),
            })),
            {
              name: process.platform === 'darwin' ? 'Volumes' : 'Computer',
              path: process.platform === 'darwin' ? '/Volumes' : path.parse(home).root,
            },
          ],
          openPaths: paths,
        };
      }
      case 'list':
        return list(args[0] as string);
      case 'stat':
        return entry(args[0] as string);
      case 'chooseFolder': {
        const result = await dialog.showOpenDialog(this.window, { properties: ['openDirectory'] });
        return result.canceled ? null : result.filePaths[0];
      }
      case 'reveal':
        shell.showItemInFolder(args[0] as string);
        return;
      case 'openExternal': {
        const error = await shell.openPath(args[0] as string);
        if (error) throw new Error(error);
        return;
      }
      case 'watch':
        return this.watchers.add(args[0] as string, args[1] as string);
      case 'unwatch':
        return this.watchers.remove(args[0] as string);
      case 'search':
        return this.search.start(args[0] as Parameters<Search['start']>[0]);
      case 'cancelSearch':
        return this.search.cancel(args[0] as string);
      case 'operate':
        return this.operations.start(args[0] as Parameters<Operations['start']>[0]);
      case 'jobs':
        return this.operations.all();
      case 'cancelJob':
        return this.operations.cancel(args[0] as string);
      case 'resolveCollision':
        return this.operations.resolve(
          args[0] as string,
          args[1] as Parameters<Operations['resolve']>[1],
          args[2] as boolean,
        );
      case 'undo':
        return this.operations.undo(args[0] as string);
      case 'resource':
        return this.resources.grant(args[0] as string);
      case 'read':
        return this.resources.read(args[0] as string, args[1] as number | undefined);
      case 'release':
        return this.resources.release(args[0] as string);
      case 'archive':
        return this.resources.archive(args[0] as string);
      case 'archiveEntry':
        return this.resources.archiveEntry(args[0] as string, args[1] as string);
      case 'save':
        return this.storage.save(args[0] as Parameters<Storage['save']>[0]);
      case 'flushed':
        return this.flushes.get(args[0] as string)?.();
      case 'clipboardWrite': {
        const paths = args[0] as string[];
        const text = paths.join('\n');
        await clipboard.writeText(text);
        this.fileClipboard = { paths, cut: args[1] as boolean, text };
        return;
      }
      case 'clipboardRead': {
        const value = this.fileClipboard;
        return value && (await clipboard.readText()) === value.text
          ? { paths: value.paths, cut: value.cut }
          : null;
      }
    }
  }
}
