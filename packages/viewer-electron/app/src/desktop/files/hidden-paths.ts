import path from 'node:path';
import type { FileVisibility } from './visibility';
import { fileVisibility } from './visibility';

type HiddenReadMode = 'folder' | 'item';
/** Crawls share bulk reads; an isolated index event only checks its path and ancestors. */
export class HiddenPaths {
  private folders = new Map<string, Promise<ReadonlySet<string>>>();
  private paths = new Map<string, Promise<boolean>>();
  constructor(
    private readonly visibility: FileVisibility = fileVisibility,
    private readonly mode: HiddenReadMode = 'folder',
  ) {}
  names(folder: string): Promise<ReadonlySet<string>> {
    let value = this.folders.get(folder);
    if (!value) {
      value = this.visibility
        .hiddenEntries(folder)
        .then((names) => new Set(names))
        .catch(() => new Set<string>());
      this.folders.set(folder, value);
    }
    return value;
  }
  async hidden(file: string, root: string): Promise<boolean> {
    return (await this.hiddenRoot(file, root)) !== undefined;
  }
  private flagged(file: string, parent: string, name: string): Promise<boolean> {
    if (this.mode === 'folder') return this.names(parent).then((names) => names.has(name));
    let read = this.paths.get(file);
    if (!read) {
      read = this.visibility.fileHidden(file).catch(() => false);
      this.paths.set(file, read);
    }
    return read;
  }
  async hiddenRoot(file: string, root: string): Promise<string | undefined> {
    const relative = path.relative(root, file);
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith('..' + path.sep) ||
      path.isAbsolute(relative)
    )
      return;
    let parent = root;
    let closest: string | undefined;
    for (const name of relative.split(path.sep)) {
      if (name.startsWith('.') || (await this.flagged(path.join(parent, name), parent, name)))
        closest = path.join(parent, name);
      parent = path.join(parent, name);
    }
    return closest;
  }
}
