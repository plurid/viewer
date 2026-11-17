import path from 'node:path';
import { rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { z } from 'zod';
import type {
  DeclaredCommand,
  DeclaredCommandReference,
  DeclaredCommandsReply,
} from '../../domain/terminals/declared-commands';
import {
  declaredCommandFiles,
  declaredCommandLimits,
  declaredCommandName,
  parseDeclaredCommands,
} from '../../domain/terminals/declared-commands';
import type { FolderProbe, FolderProbeResult } from '../../domain/workspaces/folder-facts';
import type { FolderFacts } from '../workspaces/folder-facts';
import { containsPath } from '../files/containment';
import { DocumentStore } from '../persistence/document-store';
import type { ActiveFolderScope } from '../files/file-access';
import { lstat } from '../files/stats';
import { validTerminalCommand } from '../../domain/terminals/command-text';

const reference = z
  .object({
    source: z.string().min(1).max(4096),
    name: z.string().refine(declaredCommandName),
    at: z.number().finite().nonnegative(),
  })
  .strict();
const document = z
  .object({
    version: z.literal(1),
    roots: z
      .array(
        z
          .object({
            root: z.string().min(1).max(4096),
            reference,
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
type ReferenceDocument = z.infer<typeof document>;
interface DeclaredCommandPorts {
  facts: Pick<FolderFacts, 'pass' | 'probe' | 'read'>;
  roots(): readonly string[];
  dataPath: string;
  home?: string;
  now?(): number;
  access?(file: string): ActiveFolderScope | undefined;
}
interface ReadCommands {
  root?: string;
  folder?: string;
  locations?: Map<string, string>;
  commands: DeclaredCommand[];
}

export class DeclaredCommands {
  private cache = new Map<string, { at: number; roots: string; value: Promise<ReadCommands> }>();
  private references = new Map<string, DeclaredCommandReference>();
  private store: DocumentStore<ReferenceDocument>;
  private loading?: Promise<void>;
  private writing: Promise<void> = Promise.resolve();
  private epoch = 0;
  private retained = false;

  constructor(private ports: DeclaredCommandPorts) {
    this.store = new DocumentStore(
      path.join(ports.dataPath, 'declared-commands-v1.json'),
      (value) => {
        if (Buffer.byteLength(JSON.stringify(value)) > 1024 * 1024)
          throw new Error('Declared command references exceed their limit.');
        return document.parse(value);
      },
    );
  }

  get revision(): number {
    return this.epoch;
  }

  private now(): number {
    return this.ports.now?.() ?? Date.now();
  }

  private load(): Promise<void> {
    return (this.loading ??= (async () => {
      try {
        const value = await this.store.load();
        for (const item of value?.roots ?? []) this.references.set(item.root, item.reference);
      } catch {
        try {
          if (!(await lstat(this.store.file)).isFile()) {
            this.retained = true;
            return;
          }
          await rename(this.store.file, this.store.file + '.unreadable-' + randomUUID());
        } catch {
          this.retained = true;
        }
      }
    })());
  }

  async list(directory: string): Promise<DeclaredCommandsReply> {
    if (this.ports.access && !this.ports.access(directory)) return { commands: [] };
    const [value] = await Promise.all([this.read(directory), this.load()]);
    const last = value.root && this.references.get(value.root);
    return {
      commands: this.visible(value, directory).map((item) => ({
        ...item,
        lastRun: !!last && item.source === last.source && item.name === last.name,
      })),
    };
  }

  async record(directory: string, line: string, revision = this.epoch): Promise<void> {
    if (revision !== this.epoch) return;
    if (this.ports.access && !this.ports.access(directory)) return;
    const cached = this.cache.get(path.resolve(directory));
    if (
      cached &&
      cached.roots === JSON.stringify(this.ports.roots()) &&
      cached.at + 10_000 > this.now() &&
      !this.visible(await cached.value, directory).some((item) => item.line === line)
    )
      return;
    const value = await this.read(directory, true);
    const matched = this.visible(value, directory).find((item) => item.line === line);
    if (!value.root || !matched || revision !== this.epoch) return;
    const root = value.root;
    const task = this.writing
      .catch(() => {})
      .then(async () => {
        await this.load();
        if (revision !== this.epoch || !this.visible(value, directory).includes(matched)) return;
        this.references.delete(root);
        this.references.set(root, { source: matched.source, name: matched.name, at: this.now() });
        await this.save();
      });
    this.writing = task;
    await task;
  }

  clearHistory(): Promise<void> {
    this.epoch++;
    this.cache.clear();
    const task = this.writing
      .catch(() => {})
      .then(async () => {
        await this.load();
        const existed = this.references.size > 0;
        this.references.clear();
        if (existed) await this.save();
      });
    this.writing = task;
    return task;
  }

  close(): Promise<void> {
    return this.writing;
  }

  private async save(): Promise<void> {
    if (this.retained) return;
    let value: ReferenceDocument;
    do {
      while (this.references.size > 200)
        this.references.delete(this.references.keys().next().value!);
      value = {
        version: 1,
        roots: [...this.references].map(([root, reference]) => ({ root, reference })),
      };
      if (Buffer.byteLength(JSON.stringify(value)) <= 1024 * 1024) break;
      this.references.delete(this.references.keys().next().value!);
    } while (this.references.size);
    await this.store.save(value!);
  }

  private visible(value: ReadCommands, directory: string): DeclaredCommand[] {
    if (!this.ports.access) return value.commands;
    const scope = this.ports.access(directory);
    if (!scope || !value.folder || !scope.allows(value.folder)) return [];
    return value.commands.filter((item) => {
      const file = value.locations?.get(item.source);
      return !!file && !!this.ports.access?.(file)?.allows(file);
    });
  }

  private read(directory: string, fresh = false): Promise<ReadCommands> {
    const key = path.resolve(directory);
    const roots = JSON.stringify(this.ports.roots());
    const cached = this.cache.get(key);
    if (!fresh && cached?.roots === roots && cached.at + 10_000 > this.now()) return cached.value;
    const value = this.derive(key);
    if (!fresh) {
      this.cache.set(key, { at: this.now(), roots, value });
      while (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!);
    }
    return value;
  }

  private async derive(directory: string): Promise<ReadCommands> {
    const facts = this.ports.facts;
    const pass = facts.pass();
    const home = path.resolve(this.ports.home ?? homedir());
    if (containsPath(directory, home)) return { commands: [] };
    const first = await facts.probe(directory, pass);
    if (!first.ok) return { commands: [] };
    if (containsPath(first.path, home)) return { commands: [] };
    const definitions = this.ports
      .roots()
      .map((root) => path.resolve(root))
      .filter((root) => !containsPath(root, home))
      .filter((root) => containsPath(root, directory) || containsPath(root, first.path))
      .sort((a, b) => b.length - a.length);
    let root = definitions.find((candidate) => containsPath(candidate, first.path));
    for (const candidate of definitions) {
      if (containsPath(candidate, first.path)) continue;
      const value = candidate === directory ? first : await facts.probe(candidate, pass);
      if (
        value.ok &&
        !containsPath(value.path, home) &&
        containsPath(value.path, first.path) &&
        (!root || containsPath(root, value.path))
      ) {
        root = value.path;
      }
    }
    const folders: FolderProbe[] = [first];
    let current = first.path;
    let git = first.git ? first.path : undefined;
    while (current !== root && (!git || root) && (root || folders.length < 6)) {
      const parent = path.dirname(current);
      if (parent === current || containsPath(parent, home) || (root && !containsPath(root, parent)))
        break;
      const value: FolderProbeResult = await facts.probe(parent, pass);
      if (!value.ok) break;
      folders.push(value);
      current = value.path;
      if (value.git) git ??= current;
    }
    root ??= git ?? first.path;
    const included = folders.filter(
      (folder) => containsPath(root!, folder.path) && containsPath(folder.path, first.path),
    );
    const commands: DeclaredCommand[] = [];
    const locations = new Map<string, string>();
    const seen = new Set<string>();
    const kinds = new Set<string>();
    const lockNames = [
      'pnpm-lock.yaml',
      'yarn.lock',
      'bun.lock',
      'bun.lockb',
      'package-lock.json',
      'npm-shrinkwrap.json',
    ];
    for (const [index, folder] of included.entries()) {
      const locks = included
        .slice(index)
        .flatMap((entry) => lockNames.filter((name) => entry.markers.includes(name)));
      const manager = included
        .slice(index)
        .find((entry) => entry.package?.packageManager !== undefined)?.package?.packageManager;
      const makefile = ['GNUmakefile', 'makefile', 'Makefile'].find((name) =>
        folder.markers.includes(name),
      );
      for (const file of declaredCommandFiles) {
        if (!folder.markers.includes(file)) continue;
        const make = ['GNUmakefile', 'makefile', 'Makefile'].includes(file);
        if (make && file !== makefile) continue;
        if (file === 'Procfile' && index !== 0) continue;
        const kind =
          file === 'package.json'
            ? 'package'
            : ['justfile', 'Justfile', '.justfile'].includes(file)
              ? 'just'
              : ['deno.json', 'deno.jsonc'].includes(file)
                ? 'deno'
                : undefined;
        if (kind) {
          if (kinds.has(kind)) continue;
          kinds.add(kind);
        }
        const read = await facts.read(
          path.join(folder.path, file),
          declaredCommandLimits.bytes,
          pass,
        );
        if (!read.ok) continue;
        for (const command of parseDeclaredCommands(
          file,
          Buffer.from(read.bytes).toString('utf8'),
          locks,
          { packageManager: manager, platform: process.platform },
        )) {
          const relative = path.relative(first.path, folder.path).split(path.sep).join('/');
          const line = make && relative ? `make -C ${relative} ${command.name}` : command.line;
          if (!validTerminalCommand(line) || seen.has(line)) continue;
          seen.add(line);
          const source = path
            .relative(root, path.join(folder.path, file))
            .split(path.sep)
            .join('/');
          const relativeSource = path
            .relative(first.path, path.join(folder.path, file))
            .split(path.sep)
            .join('/');
          commands.push({ ...command, source, relativeSource, line });
          locations.set(source, read.path);
        }
      }
    }
    return { root, folder: first.path, locations, commands };
  }
}
