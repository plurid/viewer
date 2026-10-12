import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { z } from 'zod';
import { DocumentStore } from './document-store';

const localPath = z
  .string()
  .min(1)
  .max(32768)
  .refine((value) => path.isAbsolute(value) && !value.includes('\0'));
const document = z
  .object({
    version: z.literal(1),
    grants: z
      .array(
        z
          .object({
            path: localPath,
            directory: z.boolean(),
            bookmark: z.string().min(1).max(65536),
          })
          .strict(),
      )
      .max(128),
  })
  .strict();
type Grant = z.infer<typeof document>['grants'][number];

export class FileAccessRequired extends Error {
  readonly code = 'FILE_ACCESS_REQUIRED';
  constructor(readonly path: string) {
    super('Allow access to this folder using the folder picker, then try again.');
  }
}
const contains = (root: string, file: string) => {
  const relative = path.relative(root, file);
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
};
async function existingParent(file: string): Promise<string> {
  try {
    return await realpath(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || path.dirname(file) === file)
      throw error;
    return path.join(await existingParent(path.dirname(file)), path.basename(file));
  }
}

/** Native picker grants are private capabilities, never JSONC preferences or IPC arguments.
 * A root is acquired lazily once for the desktop session. Its scope stays alive for
 * watches, previews and queued jobs, and is released after those services stop. */
export class FileAccess {
  readonly scoped: boolean;
  private store: DocumentStore<z.infer<typeof document>>;
  private grants: Grant[] = [];
  private loading?: Promise<void>;
  private mutations: Promise<void> = Promise.resolve();
  private active = new Map<string, { stop(): void; root: Promise<string> }>();
  private closed = false;
  constructor(
    dataPath: string,
    private native?: { start(bookmark: string): () => void },
    private internalRoots: string[] = [dataPath],
  ) {
    this.scoped = !!native;
    this.store = new DocumentStore(path.join(dataPath, 'file-access-v1.json'), (value) =>
      document.parse(value),
    );
    this.internalRoots = internalRoots.map((value) => path.resolve(value));
  }
  load(): Promise<void> {
    if (!this.scoped) return Promise.resolve();
    return (this.loading ??= this.store
      .load()
      .then((value) => {
        this.grants = value?.grants ?? [];
      })
      .catch(() => {
        // Corrupt or obsolete metadata cannot confer access. The native picker can
        // repair the private store without preventing the application from starting.
        this.grants = [];
      }));
  }
  remember(file: string, directory: boolean, bookmark: string | undefined): Promise<void> {
    if (!this.scoped) return Promise.resolve();
    const work = this.mutations
      .catch(() => {})
      .then(async () => {
        if (this.closed) throw new Error('Folder access has closed.');
        const grant = document.shape.grants.element.parse({
          path: path.resolve(file),
          directory,
          bookmark,
        });
        await this.load();
        const grants = [...this.grants.filter((item) => item.path !== grant.path), grant];
        if (grants.length > 128)
          throw new Error(
            'Too many saved folder permissions. Choose a parent folder to cover its subfolders.',
          );
        await this.store.save({ version: 1, grants });
        this.grants = grants;
        // Keep the old live scope until shutdown; existing jobs may still use it.
        // A new bookmark supersedes it on the next cold launch.
      });
    this.mutations = work;
    return work;
  }
  async require(files: readonly string[]): Promise<void> {
    if (!this.scoped) return;
    await this.load();
    if (this.closed) throw new Error('Folder access has closed.');
    for (const input of files) {
      if (this.closed) throw new Error('Folder access has closed.');
      const file = path.resolve(localPath.parse(input));
      if (this.internalRoots.some((root) => contains(root, file))) {
        const actual = await existingParent(file);
        const roots = await Promise.all(this.internalRoots.map((root) => existingParent(root)));
        if (roots.some((root) => contains(root, actual))) continue;
        throw new FileAccessRequired(file);
      }
      const candidates = this.grants
        .filter((grant) => (grant.directory ? contains(grant.path, file) : grant.path === file))
        .sort((a, b) => b.path.length - a.path.length);
      let allowed = false;
      for (const grant of candidates) {
        let active = this.active.get(grant.path);
        try {
          if (!active) {
            const stop = this.native!.start(grant.bookmark);
            active = { stop, root: realpath(grant.path) };
            // Observe rejection even if another caller is interrupted before await.
            void active.root.catch(() => {});
            this.active.set(grant.path, active);
          }
          const [root, actual] = await Promise.all([active.root, existingParent(file)]);
          if (grant.directory ? contains(root, actual) : root === actual) {
            allowed = true;
            break;
          }
        } catch {
          if (active && this.active.get(grant.path) === active) {
            this.active.delete(grant.path);
            active.stop();
          }
        }
      }
      if (this.closed) throw new Error('Folder access has closed.');
      if (!allowed) throw new FileAccessRequired(file);
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    await this.mutations.catch(() => {});
    const active = [...this.active.values()];
    this.active.clear();
    for (const scope of active) scope.stop();
  }
}
