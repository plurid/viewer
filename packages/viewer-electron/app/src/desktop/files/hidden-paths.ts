import path from 'node:path';
import type { FileVisibility } from './visibility';
import { fileVisibility } from './visibility';

/** One folder read per search or crawl, including ancestors of a Spotlight or index hit. */
export class HiddenPaths {
  private folders = new Map<string, Promise<ReadonlySet<string>>>();
  constructor(private readonly visibility: FileVisibility = fileVisibility) {}
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
      if (name.startsWith('.') || (await this.names(parent)).has(name))
        closest = path.join(parent, name);
      parent = path.join(parent, name);
    }
    return closest;
  }
}
