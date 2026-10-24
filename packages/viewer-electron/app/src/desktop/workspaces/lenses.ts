import { packageExtensions } from '../../domain/files/entries';
import { constants } from 'node:fs';
import {
  access as fileAccess,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
} from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DefinitionFiles } from '../persistence/definition-files';
import { DocumentStore } from '../persistence/document-store';
import { fileCoordination } from '../files/file-coordination';
import { localPath } from '../schemas';
import { pathMapper, type FileChange } from '../../domain/files/changes';
import {
  applyLensOps,
  emptyLens,
  formatLens,
  isLensChildName,
  lensFileName,
  lensFolder,
  lensGroupIDSchema,
  lensHeader,
  lensLimits,
  lensSchema,
  lensSubfolder,
  lensSuffix,
  matchLensMembers,
  normalizeLens,
  type Lens,
  type LensApplied,
  type LensDocument,
  type LensFolder,
  type LensOp,
} from '../../domain/files/lenses';

const readme = `# Viewer

Viewer keeps the lenses for this folder here. A lens groups the items next to this
folder without moving them; each file in \`lenses/\` is one lens, shared with everyone
who has this folder.

Deleting this folder removes the lenses only. Your files are never touched.

To keep lenses out of version control, add \`.viewer/\` to \`.gitignore\`.
`;
const ownReadme = (text: string) => text.includes('Viewer keeps the lenses for this folder here.');
/** Folders whose contents belong to an application or a document (`isPackage`), or Home, never
 * receive a `.viewer`. */
const unwritable = new Set(['EACCES', 'EPERM', 'EROFS']);
const missingDays = 30;
const stateSchema = z
  .object({
    version: z.literal(1),
    folders: z
      .array(
        z
          .object({
            path: localPath,
            used: z.number(),
            /** Item name and `dev:ino`, so renames made outside Viewer can be recognized. */
            hints: z.array(z.tuple([z.string().max(255), z.string().max(64)])).max(50000),
            /** Lens ID, item name and when it was first found missing. */
            missing: z.array(z.tuple([z.uuid(), z.string().max(255), z.number()])).max(50000),
          })
          .strict(),
      )
      .max(2000),
    collapsed: z.array(z.tuple([z.uuid(), z.array(lensGroupIDSchema).max(1000)])).max(2000),
  })
  .strict();
type LensState = z.infer<typeof stateSchema>;
type FolderRecord = LensState['folders'][number];
const emptyState = (): LensState => ({ version: 1, folders: [], collapsed: [] });
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code;
const identityOf = (info: { dev: number; ino: number }) => `${info.dev}:${info.ino}`;

/**
 * Lenses live in `<folder>/.viewer/lenses/`, created only when a person makes one. Folders
 * Viewer cannot write, Home, application packages and a `.viewer` that belongs to something else
 * keep lenses in Viewer's data instead, marked as only on this Mac. Lenses never move, rename or
 * remove the items they group.
 */
export class Lenses {
  private shared: DefinitionFiles<Lens>;
  private own: DefinitionFiles<Lens>;
  private store: DocumentStore<LensState>;
  private state?: Promise<LensState>;
  private saving?: ReturnType<typeof setTimeout>;
  constructor(
    private dataPath: string,
    private access: (files: readonly string[]) => Promise<void>,
    private options: {
      home: string;
      /** Moves a lens file inside a person's folder to the Trash as an undoable operation. */
      trash(file: string): Promise<string>;
      /** Moves a lens file kept in Viewer's data to the Trash. */
      trashOwn(file: string): Promise<void>;
      changed(folder: string): void;
      now?: () => number;
    },
  ) {
    const format = { serialize: formatLens, mode: 0o644 };
    this.shared = new DefinitionFiles(
      lensSchema,
      'Lens',
      lensHeader + '\n',
      access,
      fileCoordination,
      lensLimits.bytes,
      format,
    );
    this.own = new DefinitionFiles(
      lensSchema,
      'Lens',
      lensHeader + '\n',
      async () => {},
      fileCoordination,
      lensLimits.bytes,
      format,
    );
    this.store = new DocumentStore(path.join(dataPath, 'lens-state-v1.json'), (value) =>
      stateSchema.parse(value),
    );
  }
  private now() {
    return this.options.now?.() ?? Date.now();
  }
  private load(): Promise<LensState> {
    // Hints and collapsed groups are conveniences; damaged state starts over.
    return (this.state ??= this.store
      .load()
      .then((value) => value ?? emptyState())
      .catch(() => emptyState()));
  }
  private persist() {
    clearTimeout(this.saving);
    this.saving = setTimeout(() => void this.save(), 500);
  }
  private async save() {
    clearTimeout(this.saving);
    this.saving = undefined;
    const state = await this.load();
    state.folders = state.folders.toSorted((a, b) => b.used - a.used).slice(0, 2000);
    await this.store.save(state).catch(() => {});
  }
  private async record(folder: string): Promise<FolderRecord> {
    const state = await this.load();
    let record = state.folders.find((item) => item.path === folder);
    if (!record) {
      record = { path: folder, used: this.now(), hints: [], missing: [] };
      state.folders.push(record);
    }
    record.used = this.now();
    return record;
  }
  private localDirectory(folder: string) {
    return path.join(
      this.dataPath,
      'lenses',
      createHash('sha256').update(folder).digest('hex').slice(0, 40),
    );
  }
  /** Where this folder's shared lenses are, and whether Viewer may create them there. */
  private async location(
    folder: string,
  ): Promise<{ directory?: string; creatable: boolean; writable: boolean }> {
    if (
      path.resolve(folder) === path.resolve(this.options.home) ||
      packageExtensions.has(path.extname(folder).slice(1).toLowerCase())
    )
      return { creatable: false, writable: false };
    const viewer = path.join(folder, lensFolder),
      directory = path.join(viewer, lensSubfolder);
    const info = await lstat(viewer).catch((error: unknown) =>
      errorCode(error) === 'ENOENT' ? null : undefined,
    );
    if (info === undefined) return { creatable: false, writable: false };
    const writable = await fileAccess(folder, constants.W_OK).then(
      () => true,
      () => false,
    );
    if (info === null) return { creatable: writable, writable };
    if (!info.isDirectory() || info.isSymbolicLink()) return { creatable: false, writable: false };
    const lenses = await lstat(directory).catch(() => null);
    if (lenses?.isDirectory() && !lenses.isSymbolicLink())
      return {
        directory,
        creatable: true,
        writable: await fileAccess(directory, constants.W_OK).then(
          () => true,
          () => false,
        ),
      };
    // A `.viewer` folder Viewer did not make, such as an older app's data, is left alone.
    const ours = await readFile(path.join(viewer, 'README.md'), 'utf8').then(
      ownReadme,
      () => false,
    );
    return { creatable: ours && writable, writable };
  }
  private async readAll(
    directory: string,
    local: boolean,
    writable: boolean,
    into: LensFolder,
  ): Promise<void> {
    const files = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const names = files
      .filter((file) => file.isFile() && file.name.endsWith(lensSuffix))
      .map((file) => file.name)
      .sort()
      .slice(0, lensLimits.lenses);
    for (const name of names) {
      const file = path.join(directory, name);
      try {
        const document = await (local ? this.own : this.shared).read(file);
        const { lens, repairs } = normalizeLens(document.definition);
        into.lenses.push({ file, revision: document.revision, lens, local, writable, repairs });
      } catch (error) {
        into.broken.push({ file, message: (error as Error).message });
      }
    }
  }
  async list(folder: string): Promise<LensFolder> {
    await this.access([folder]);
    const where = await this.location(folder);
    const result: LensFolder = {
      folder,
      lenses: [],
      broken: [],
      shared: !!where.directory || where.creatable,
      collapsed: {},
    };
    if (where.directory) await this.readAll(where.directory, false, where.writable, result);
    await this.readAll(this.localDirectory(folder), true, true, result);
    result.lenses.sort(
      (a, b) => a.lens.order - b.lens.order || a.lens.name.localeCompare(b.lens.name),
    );
    if (!result.lenses.length) return result;
    await this.heal(folder, result);
    const state = await this.load();
    const ids = new Set(result.lenses.map((document) => document.lens.id));
    for (const [lens, groups] of state.collapsed)
      if (ids.has(lens)) result.collapsed[lens] = groups;
    return result;
  }
  /**
   * Repairs names changed outside Viewer: case or Unicode differences, and items renamed in
   * Finder that kept their identity. Remembers identities for next time and when items went
   * missing, so long-gone entries can be cleaned up later.
   */
  private async heal(folder: string, result: LensFolder): Promise<void> {
    const names = (await readdir(folder).catch(() => [] as string[])).filter(isLensChildName);
    const present = new Set(names);
    const record = await this.record(folder);
    const hints = new Map(record.hints);
    const identities = new Map<string, string>();
    const identify = async (candidates: string[], limit: number) => {
      for (const name of candidates.slice(0, limit))
        if (!identities.has(name))
          await lstat(path.join(folder, name)).then(
            (info) => identities.set(name, identityOf(info)),
            () => {},
          );
    };
    for (const [index, document] of result.lenses.entries()) {
      let match = matchLensMembers(document.lens.members, names);
      if (match.missing.some((name) => hints.has(name))) {
        const claimed = new Set(match.matched.values());
        await identify(
          names.filter((name) => !claimed.has(name)),
          2000,
        );
        match = matchLensMembers(document.lens.members, names, { hints, of: identities });
      }
      if (match.renames.length && document.writable) {
        const ops: LensOp[] = match.renames.map((item) => ({ kind: 'rename-member', ...item }));
        const saved = await this.update(folder, document, ops).catch(() => null);
        if (saved) result.lenses[index] = saved.document;
        for (const { from, to } of match.renames) {
          const identity = hints.get(from);
          hints.delete(from);
          if (identity) hints.set(to, identity);
        }
      }
      const missing = new Set(match.missing);
      const lensID = document.lens.id;
      record.missing = record.missing.filter(
        ([lens, name]) => lens !== lensID || missing.has(name),
      );
      for (const name of missing)
        if (!record.missing.some(([lens, item]) => lens === lensID && item === name))
          record.missing.push([lensID, name, this.now()]);
    }
    // Identities for members not yet remembered, a bounded number per visit.
    const unknown = [
      ...new Set(
        result.lenses.flatMap((document) => document.lens.members.map((member) => member.name)),
      ),
    ].filter((name) => present.has(name) && !hints.has(name));
    await identify(unknown, 500);
    for (const name of unknown) {
      const identity = identities.get(name);
      if (identity) hints.set(name, identity);
    }
    for (const name of hints.keys()) if (!present.has(name)) hints.delete(name);
    record.hints = [...hints].slice(0, 50000);
    this.persist();
  }
  private async update(
    folder: string,
    document: Pick<LensDocument, 'file' | 'local' | 'writable'>,
    ops: readonly LensOp[],
  ): Promise<LensApplied> {
    const { document: saved, result } = await (document.local ? this.own : this.shared).update(
      document.file,
      (current) => {
        if (!current) throw new Error('This lens was removed. Reload the folder to continue.');
        const applied = applyLensOps(normalizeLens(current).lens, ops);
        return { definition: applied.lens, result: applied.dropped };
      },
    );
    if (!saved) throw new Error('This lens was removed. Reload the folder to continue.');
    this.options.changed(folder);
    return {
      document: {
        file: saved.file,
        revision: saved.revision,
        lens: saved.definition,
        local: document.local,
        writable: true,
        repairs: [],
      },
      dropped: result ?? [],
    };
  }
  /** The lens file's store, checked to be one of this folder's lens directories. */
  private async owner(
    folder: string,
    file: string,
  ): Promise<{ local: boolean; writable: boolean }> {
    const name = path.basename(file);
    if (!name.endsWith(lensSuffix) || name.startsWith('.'))
      throw new Error('Choose a lens of this folder.');
    if (path.dirname(file) === this.localDirectory(folder)) return { local: true, writable: true };
    if (path.dirname(file) !== path.join(folder, lensFolder, lensSubfolder))
      throw new Error('Choose a lens of this folder.');
    await this.access([folder]);
    const where = await this.location(folder);
    if (!where.directory) throw new Error('This folder has no lenses.');
    return { local: false, writable: where.writable };
  }
  async apply(folder: string, file: string, ops: readonly LensOp[]): Promise<LensApplied> {
    const owner = await this.owner(folder, file);
    if (!owner.writable)
      throw new Error('This folder cannot be changed, so its lenses are read-only here.');
    // Items missing for a month are dropped with a person's next edit.
    const record = await this.record(folder);
    const lensID = (await (owner.local ? this.own : this.shared).read(file)).definition.id;
    const expired = record.missing.filter(
      ([lens, , since]) => lens === lensID && this.now() - since > missingDays * 86400000,
    );
    const applied = await this.update(folder, { file, ...owner }, [
      ...expired.map(([, name]): LensOp => ({ kind: 'forget', name })),
      ...ops,
    ]);
    if (expired.length) {
      record.missing = record.missing.filter((item) => !expired.includes(item));
      this.persist();
    }
    await this.remember(
      folder,
      ops.flatMap((op) => (op.kind === 'place' ? [op.name] : [])),
    );
    return applied;
  }
  private async remember(folder: string, names: string[]) {
    if (!names.length) return;
    const record = await this.record(folder);
    const hints = new Map(record.hints);
    for (const name of names.slice(0, 200))
      await lstat(path.join(folder, name)).then(
        (info) => hints.set(name, identityOf(info)),
        () => {},
      );
    record.hints = [...hints];
    this.persist();
  }
  /** The shared lens directory, made on first use with a README explaining it. */
  private async prepareShared(folder: string): Promise<string> {
    const viewer = path.join(folder, lensFolder),
      directory = path.join(viewer, lensSubfolder);
    await this.access([folder]);
    return fileCoordination.run([{ path: viewer, mode: 'write' }], async () => {
      const made = await mkdir(viewer, { mode: 0o755 }).then(
        () => true,
        (error: unknown) => {
          if (errorCode(error) === 'EEXIST') return false;
          throw error;
        },
      );
      const info = await lstat(viewer);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error('The .viewer item in this folder is not a folder Viewer can use.');
      if (made) {
        const handle = await open(path.join(viewer, 'README.md'), 'wx', 0o644).catch(() => null);
        if (handle)
          try {
            await handle.writeFile(readme);
          } finally {
            await handle.close();
          }
      }
      await mkdir(directory, { mode: 0o755 }).catch((error: unknown) => {
        if (errorCode(error) !== 'EEXIST') throw error;
      });
      const lenses = await lstat(directory);
      if (!lenses.isDirectory() || lenses.isSymbolicLink())
        throw new Error('The .viewer/lenses item in this folder is not a folder Viewer can use.');
      return directory;
    });
  }
  private async prepareLocal(folder: string): Promise<string> {
    const directory = this.localDirectory(folder);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const handle = await open(path.join(directory, 'folder.json'), 'w', 0o600);
    try {
      await handle.writeFile(JSON.stringify({ folder }));
    } finally {
      await handle.close();
    }
    return directory;
  }
  async create(folder: string, name: string, ops: readonly LensOp[] = []): Promise<LensDocument> {
    await this.access([folder]);
    const where = await this.location(folder);
    let directory: string | undefined,
      local = false;
    if (where.directory || where.creatable)
      directory = await this.prepareShared(folder).catch((error: unknown) => {
        if (unwritable.has(errorCode(error) ?? '')) return undefined;
        throw error;
      });
    if (!directory) {
      directory = await this.prepareLocal(folder);
      local = true;
    }
    const existing = (await readdir(directory).catch(() => [] as string[])).filter((file) =>
      file.endsWith(lensSuffix),
    );
    if (existing.length >= lensLimits.lenses) throw new Error('This folder has too many lenses.');
    const file = path.join(directory, lensFileName(name, existing));
    const { lens, dropped } = applyLensOps(emptyLens(randomUUID(), name, existing.length), ops);
    if (dropped.length) throw new Error(dropped[0]);
    const created = await (local ? this.own : this.shared)
      .update(file, (current) => {
        if (current) throw new Error('Another lens was saved with this name. Try again.');
        return { definition: lens, result: null };
      })
      .catch(async (error: unknown) => {
        // A folder that refuses the file itself still gets a lens on this Mac.
        if (local || !unwritable.has(errorCode(error) ?? '')) throw error;
        local = true;
        const fallback = path.join(await this.prepareLocal(folder), path.basename(file));
        return this.own.update(fallback, () => ({ definition: lens, result: null }));
      });
    if (!created.document) throw new Error('The lens could not be created.');
    await this.remember(
      folder,
      ops.flatMap((op) => (op.kind === 'place' ? [op.name] : [])),
    );
    this.options.changed(folder);
    return {
      file: created.document.file,
      revision: created.document.revision,
      lens: created.document.definition,
      local,
      writable: true,
      repairs: [],
    };
  }
  /** Moves a lens file to the Trash. Inside the folder this is an undoable operation. */
  async trash(folder: string, file: string): Promise<{ job?: string }> {
    const owner = await this.owner(folder, file);
    if (owner.local) {
      await this.options.trashOwn(file);
      this.options.changed(folder);
      return {};
    }
    // The last lens takes Viewer's now-empty folder along, as one undoable Trash item, rather than
    // leaving a README and an empty lenses/ behind (2026-10-23).
    const viewer = path.join(folder, lensFolder);
    if (await this.onlyLens(viewer, file)) return { job: await this.options.trash(viewer) };
    return { job: await this.options.trash(file) };
  }
  /** Whether `file` is the one lens in a `.viewer` holding nothing but Viewer's own README. */
  private async onlyLens(viewer: string, file: string): Promise<boolean> {
    if (path.dirname(file) !== path.join(viewer, lensSubfolder)) return false;
    const [inside, lenses] = await Promise.all([
      readdir(viewer).catch(() => null),
      readdir(path.join(viewer, lensSubfolder)).catch(() => null),
    ]);
    if (!inside || !lenses || lenses.length !== 1 || lenses[0] !== path.basename(file))
      return false;
    if (inside.some((name) => name !== 'README.md' && name !== lensSubfolder)) return false;
    return inside.includes('README.md')
      ? readFile(path.join(viewer, 'README.md'), 'utf8').then(ownReadme, () => false)
      : true;
  }
  /** Moves a lens kept on this Mac into the folder, once the folder can hold it. */
  async share(folder: string, file: string): Promise<LensDocument> {
    const owner = await this.owner(folder, file);
    if (!owner.local) throw new Error('This lens is already stored in the folder.');
    const where = await this.location(folder);
    if (!where.directory && !where.creatable)
      throw new Error('This folder cannot hold lenses. It stays on this Mac.');
    const { definition } = await this.own.read(file);
    const directory = await this.prepareShared(folder);
    const existing = (await readdir(directory)).filter((name) => name.endsWith(lensSuffix));
    const target = path.join(directory, lensFileName(definition.name, existing));
    const saved = await this.shared.update(target, (current) => {
      if (current) throw new Error('Another lens was saved with this name. Try again.');
      return { definition, result: null };
    });
    await this.options.trashOwn(file);
    this.options.changed(folder);
    return {
      file: target,
      revision: saved.document!.revision,
      lens: definition,
      local: false,
      writable: true,
      repairs: [],
    };
  }
  async collapse(lens: string, groups: readonly string[]): Promise<void> {
    const state = await this.load();
    state.collapsed = state.collapsed.filter(([id]) => id !== lens);
    if (groups.length) state.collapsed.unshift([lens, [...new Set(groups)].slice(0, 1000)]);
    state.collapsed = state.collapsed.slice(0, 2000);
    this.persist();
  }
  /**
   * Follows renames and moves made by Viewer: an item renamed inside its folder keeps its group
   * and place; a moved folder keeps its lenses on this Mac and its remembered identities. An
   * item moved elsewhere stays listed as missing, so Undo puts it back where it was.
   */
  async remap(changes: readonly FileChange[]): Promise<void> {
    if (!changes.length) return;
    const map = pathMapper(changes);
    const state = await this.load();
    for (const record of state.folders) record.path = map(record.path);
    const root = path.join(this.dataPath, 'lenses');
    for (const directory of await readdir(root).catch(() => [] as string[])) {
      const marker = path.join(root, directory, 'folder.json');
      const folder = await readFile(marker, 'utf8')
        .then((text) => z.object({ folder: localPath }).parse(JSON.parse(text)).folder)
        .catch(() => null);
      if (!folder || map(folder) === folder) continue;
      const moved = await rename(path.join(root, directory), this.localDirectory(map(folder))).then(
        () => true,
        () => false,
      );
      if (moved) await this.prepareLocal(map(folder)).catch(() => {});
    }
    for (const change of changes) {
      const parent = path.dirname(change.source),
        from = path.basename(change.source),
        to = path.basename(change.destination);
      if (path.dirname(change.destination) !== parent || from === to) continue;
      if (!isLensChildName(from) || !isLensChildName(to)) continue;
      const record = state.folders.find((item) => item.path === parent);
      if (record)
        record.hints = record.hints.map(([name, identity]) => [
          name === from ? to : name,
          identity,
        ]);
      const folder = await this.list(parent).catch(() => null);
      for (const document of folder?.lenses ?? [])
        if (document.writable && document.lens.members.some((member) => member.name === from))
          await this.update(parent, document, [{ kind: 'rename-member', from, to }]).catch(
            () => {},
          );
    }
    this.persist();
  }
  async close(): Promise<void> {
    await Promise.all([this.shared.flush(), this.own.flush()]);
    if (this.saving) await this.save();
    await this.store.flush().catch(() => {});
  }
}
