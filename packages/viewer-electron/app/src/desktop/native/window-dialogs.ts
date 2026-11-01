import { randomUUID } from 'node:crypto';
import { lstat, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  BrowserWindow,
  OpenDialogOptions,
  OpenDialogReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue,
  MessageBoxOptions,
  MessageBoxReturnValue,
} from 'electron';
import type {
  DialogPlace,
  DialogPrompt,
  DialogReply,
  DialogRequest,
  FileDialogPrompt,
} from '../../domain/dialogs';
import { matchesDialogFilter } from '../../domain/dialogs';
import { absolute, list, validName } from '../files/filesystem';
import { packageExtensions } from '../../domain/files/entries';

type Answer = { paths: string[]; button: number; system?: boolean };
interface Pending {
  prompt: DialogPrompt;
  resolve(answer: Answer): void;
  overwrite: boolean;
  conflict?: { path: string; stamp: string };
  removeAbort?(): void;
}
interface Ports {
  home: string;
  places(): Promise<DialogPlace[]>;
  access(paths: string[]): Promise<void>;
  publish(prompt: DialogPrompt | null): void;
}
const owners = new WeakMap<BrowserWindow, WindowDialogs>();
export function windowDialogs(
  window: BrowserWindow | undefined,
  requireReady = true,
): WindowDialogs | undefined {
  const owner = window && !window.isDestroyed() ? owners.get(window) : undefined;
  return owner && (!requireReady || owner.ready) ? owner : undefined;
}
export function attachWindowDialogs(window: BrowserWindow, dialogs: WindowDialogs) {
  owners.set(window, dialogs);
  const stop = () => dialogs.stop();
  window.on('closed', stop);
  window.webContents.on('render-process-gone', stop);
  window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) stop();
  });
}
const stamp = (info: Awaited<ReturnType<typeof lstat>>) =>
  `${info.dev}:${info.ino}:${info.mtimeMs}:${info.size}`;

/** A window may answer only its own outstanding desktop question. Filesystem checks stay here. */
export class WindowDialogs {
  ready = false;
  private queue: Pending[] = [];
  constructor(private ports: Ports) {}

  stop() {
    this.ready = false;
    for (const item of this.queue.splice(0)) {
      item.removeAbort?.();
      item.resolve(this.cancelled(item.prompt));
    }
  }
  private cancelled(prompt: DialogPrompt): Answer {
    return { paths: [], button: prompt.kind === 'message' ? prompt.cancelId : 0 };
  }
  private present(prompt: DialogPrompt, overwrite = false, signal?: AbortSignal): Promise<Answer> {
    if (!this.ready || signal?.aborted) return Promise.resolve(this.cancelled(prompt));
    if (this.queue.length >= 8) throw new Error('Finish the open dialogs before opening another.');
    return new Promise((resolve) => {
      const item: Pending = { prompt, resolve, overwrite };
      this.queue.push(item);
      if (signal) {
        const abort = () => this.finish(item, this.cancelled(prompt));
        signal.addEventListener('abort', abort, { once: true });
        item.removeAbort = () => signal.removeEventListener('abort', abort);
      }
      if (this.queue.length === 1) this.ports.publish(prompt);
    });
  }
  private finish(item: Pending, answer: Answer) {
    const index = this.queue.indexOf(item);
    if (index < 0) return;
    this.queue.splice(index, 1);
    item.removeAbort?.();
    item.resolve(answer);
    if (index === 0) this.ports.publish(this.queue[0]?.prompt ?? null);
  }
  private active(id: string): Pending {
    const item = this.queue[0];
    if (!item || item.prompt.id !== id) throw new Error('This dialog is no longer open.');
    return item;
  }
  private async filePrompt(
    mode: 'open' | 'save',
    options: OpenDialogOptions | SaveDialogOptions,
  ): Promise<FileDialogPrompt> {
    const properties: readonly string[] = options.properties ?? [];
    const defaultPath = options.defaultPath
      ? absolute(path.resolve(this.ports.home, options.defaultPath))
      : this.ports.home;
    const info = await stat(defaultPath).catch((error: NodeJS.ErrnoException) => {
      if (!['ENOENT', 'EACCES', 'EPERM'].includes(error.code ?? '')) throw error;
      return undefined;
    });
    return {
      id: randomUUID(),
      kind: 'file',
      mode,
      title:
        options.title ||
        (mode === 'save'
          ? 'Save file'
          : properties.includes('openDirectory')
            ? 'Choose folder'
            : 'Open file'),
      message: options.message,
      buttonLabel:
        options.buttonLabel ||
        (mode === 'save'
          ? 'Save'
          : properties.includes('openDirectory')
            ? 'Choose folder'
            : 'Open'),
      directory: properties.includes('openDirectory'),
      files: !properties.includes('openDirectory') || properties.includes('openFile'),
      multiple: properties.includes('multiSelections'),
      hidden: properties.includes('showHiddenFiles'),
      folder: info?.isDirectory() ? defaultPath : path.dirname(defaultPath),
      separator: path.sep,
      name: mode === 'save' && !info?.isDirectory() ? path.basename(defaultPath) : '',
      filters: options.filters ?? [],
      places: await this.ports.places(),
    };
  }
  async open(options: OpenDialogOptions): Promise<OpenDialogReturnValue | undefined> {
    const answer = await this.present(await this.filePrompt('open', options));
    return answer.system ? undefined : { canceled: !answer.paths.length, filePaths: answer.paths };
  }
  async save(
    options: SaveDialogOptions,
    overwrite: boolean,
  ): Promise<SaveDialogReturnValue | undefined> {
    const answer = await this.present(await this.filePrompt('save', options), overwrite);
    return answer.system
      ? undefined
      : { canceled: !answer.paths.length, filePath: answer.paths[0] ?? '' };
  }
  async message(
    options: MessageBoxOptions,
    destructiveId?: number,
  ): Promise<MessageBoxReturnValue> {
    const buttons = options.buttons?.length ? options.buttons : ['OK'];
    const answer = await this.present(
      {
        id: randomUUID(),
        kind: 'message',
        title: options.title || 'Viewer',
        message: options.message,
        detail: options.detail || '',
        buttons,
        defaultId: options.defaultId ?? 0,
        destructiveId,
        cancelId:
          options.cancelId ??
          Math.max(
            0,
            buttons.findIndex((label) => /^(cancel|no)$/i.test(label)),
          ),
      },
      false,
      options.signal,
    );
    return { response: answer.button, checkboxChecked: false };
  }
  async request(request: DialogRequest): Promise<DialogReply> {
    if (request.kind === 'current') {
      this.ready = true;
      return { prompt: this.queue[0]?.prompt ?? null };
    }
    const item = this.active(request.id);
    const prompt = item.prompt;
    if (request.kind === 'cancel') {
      this.finish(item, this.cancelled(prompt));
      return {};
    }
    if (request.kind === 'answer') {
      if (prompt.kind !== 'message' || request.button >= prompt.buttons.length)
        throw new Error('Choose an available answer.');
      this.finish(item, { paths: [], button: request.button });
      return {};
    }
    if (prompt.kind !== 'file') throw new Error('This dialog does not choose files.');
    if (request.kind === 'system') {
      this.finish(item, { paths: [], button: 0, system: true });
      return {};
    }
    if (request.kind === 'browse') {
      const folder =
        request.path === '~'
          ? this.ports.home
          : request.path.startsWith('~/')
            ? path.join(this.ports.home, request.path.slice(2))
            : absolute(request.path);
      await this.ports.access([folder]);
      const listing = await list(folder);
      this.active(request.id);
      await this.ports.access([listing.path]);
      return { listing };
    }
    if (request.kind === 'new-folder') {
      const folder = path.join(absolute(request.parent), validName(request.name));
      await this.ports.access([request.parent, folder]);
      this.active(request.id);
      await mkdir(folder);
      return { listing: await list(folder) };
    }
    const paths = [...new Set(request.paths.map(absolute))];
    if ((!prompt.multiple || prompt.mode === 'save') && paths.length !== 1)
      throw new Error('Choose one item.');
    await this.ports.access(paths);
    const extensions = prompt.filters.flatMap((filter) => filter.extensions);
    for (const file of paths) {
      if (prompt.mode === 'save') {
        validName(path.basename(file));
        if (!matchesDialogFilter(file, extensions))
          throw new Error('Use a file extension shown in the file type filter.');
        if (!(await stat(path.dirname(file))).isDirectory())
          throw new Error('Choose an existing destination folder.');
        const info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
          return undefined;
        });
        if (info) {
          if (!item.overwrite || !info.isFile() || info.isSymbolicLink())
            throw new Error('An item with this name already exists. Choose a different name.');
          if (
            !request.replace ||
            item.conflict?.path !== file ||
            item.conflict.stamp !== stamp(info)
          ) {
            item.conflict = { path: file, stamp: stamp(info) };
            return { conflict: file };
          }
        }
      } else {
        const info = await stat(file);
        const bundle =
          info.isDirectory() && packageExtensions.has(path.extname(file).slice(1).toLowerCase());
        if (
          info.isDirectory() && !bundle
            ? !prompt.directory
            : !(prompt.files || (prompt.directory && bundle)) ||
              (!info.isFile() && !bundle) ||
              !matchesDialogFilter(file, extensions)
        )
          throw new Error(
            prompt.directory && !prompt.files ? 'Choose a folder.' : 'Choose a supported file.',
          );
      }
    }
    this.active(request.id);
    await this.ports.access(paths);
    this.finish(item, { paths, button: 0 });
    return {};
  }
}
