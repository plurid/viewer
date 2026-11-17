import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Workspace } from '../../domain/contracts';
import type { WorkspaceDefinitionReply } from '../../domain/workspaces/definitions/schema';
import { captureDefinition, proposeDefinition } from '../../domain/workspaces/definitions/capture';
import { tokenizePath } from '../../domain/workspaces/definitions/paths';
import type {
  DefinitionCatalog,
  DefinitionEntry,
  DefinitionProblem,
  DefinitionRootState,
  WorkspacesFile,
} from '../../domain/workspaces/definitions/schema';
import {
  definitionEntrySchema,
  definitionKeySchema,
  definitionLimits,
  workspacesFileSchema,
} from '../../domain/workspaces/definitions/schema';
import {
  definitionLocations,
  missingDefinitionRoot,
  resolveCatalog,
} from '../../domain/workspaces/definitions/catalog';
import type { CheckedFolder } from '../../domain/files/folder-checks';
import { folderCheckConcurrency, folderCheckTimeout } from '../../domain/files/folder-checks';
import { rankWorkspaceChoices } from '../../domain/workspaces/definitions/query';
import type { DefinedWorkspaces } from './defined-workspaces';
import type { SettingsSnapshot } from '../../domain/services';
import { builtInProfiles } from '../../domain/preferences/profiles';
import { errorMessage } from '../../domain/errors';
import { JsoncConfiguration } from '../preferences/configuration';
import { watchFileChanges } from '../persistence/watch-file';
import type { ProjectManagerRead } from './project-manager';
import { expandProjectPath, projectManagerPath, readProjectManager } from './project-manager';

const starter = `// Definitions are searched by name and opened as whole workspaces.
// VS Code Project Manager is read live. An entry with the same key overrides its project.
{
  "$schema": "workspaces.schema.json",
  "version": 1,
  "sources": { "projectManager": { "enabled": true } },
  "workspaces": {
    // "sample/site": { "root": "~/Projects/sample", "aliases": ["sample"] }
  }
}
`;

export interface WorkspaceDefinitionsPorts {
  access(files: readonly string[]): Promise<void>;
  settings(): SettingsSnapshot['settings'];
  emit(catalog: DefinitionCatalog): void;
  checkRoot(root: string): Promise<CheckedFolder>;
  watchVolumes?(changed: () => void): () => void;
  memory?: DefinedWorkspaces;
}

export class WorkspaceDefinitions {
  readonly configuration: JsoncConfiguration<WorkspacesFile>;
  private file = workspacesFileSchema.parse({ version: 1 });
  private projects?: ProjectManagerRead;
  private projectsPath = '';
  private stopSource?: () => void;
  private stopVolumes?: () => void;
  private sourceMissingSince?: number;
  private timer?: ReturnType<typeof setTimeout>;
  private loading?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private roots = new Map<string, { state: DefinitionRootState; at: number }>();
  private wantedRoots = new Set<string>();
  private shownRoots = new Map<number, string[]>();
  private stopMemory?: () => void;
  private projectRoots: string[] = [];
  private rootEpoch = 0;
  private rootCheck?: ReturnType<typeof setTimeout>;
  private rootEmit?: ReturnType<typeof setTimeout>;
  private problems: DefinitionProblem[] = [];
  private rootProblems = new Map<string, DefinitionProblem>();
  private current: DefinitionCatalog;
  constructor(
    directory: string,
    readonly home: string,
    private ports: WorkspaceDefinitionsPorts,
  ) {
    this.configuration = new JsoncConfiguration(
      directory,
      (value) => workspacesFileSchema.parse(value),
      undefined,
      {
        name: 'workspaces.jsonc',
        schemaName: 'workspaces.schema.json',
        objectValues: true,
        limit: definitionLimits.file,
      },
    );
    this.current = {
      revision: 0,
      file: { path: this.configuration.file, state: 'absent' },
      projectManager: {
        path: projectManagerPath(home),
        state: 'absent',
        projects: 0,
        missing: 0,
        disabled: 0,
        remote: 0,
        duplicateKeys: 0,
      },
      definitions: [],
      diagnostics: [],
    };
  }
  snapshot(): DefinitionCatalog {
    return structuredClone(this.current);
  }
  entry(key: string) {
    return this.current.definitions.find((item) => item.key === key);
  }
  command(key: string, plane: number): string | undefined {
    const item = this.entry(key)?.planes.find((item) => item.index === plane)?.plane;
    return item?.kind === 'terminal' ? item.command : undefined;
  }
  load(): Promise<void> {
    return (this.loading ??= (async () => {
      await this.ports.memory?.load();
      this.stopMemory = this.ports.memory?.subscribe(() => this.publishMemory());
      await this.reload();
      const schema = z.toJSONSchema(workspacesFileSchema, { unrepresentable: 'any' });
      if (schema.properties?.workspaces)
        schema.properties.workspaces = {
          type: 'object',
          maxProperties: definitionLimits.entries,
          additionalProperties: z.toJSONSchema(definitionEntrySchema, { unrepresentable: 'any' }),
        };
      await this.configuration.schema(schema);
      if (!this.stopped) {
        this.configuration.watch(() => this.schedule());
        this.stopVolumes = this.ports.watchVolumes?.(() => this.refreshRoots());
      }
    })());
  }
  private schedule(): void {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.reload().catch(() => {});
    }, 150);
  }
  reload(): Promise<void> {
    const work = this.queue.catch(() => {}).then(() => this.resolve());
    this.queue = work;
    return work;
  }
  private async resolve(): Promise<void> {
    const value = await this.configuration.read();
    let fileState: DefinitionCatalog['file']['state'] = value
      ? 'read'
      : this.configuration.diagnostics.length
        ? 'unreadable'
        : 'absent';
    if (value) this.file = value;
    else if (!this.configuration.diagnostics.length)
      this.file = workspacesFileSchema.parse({ version: 1 });
    else if (this.configuration.diagnostics.length) {
      const recovered = await this.configuration.recovery();
      if (recovered) {
        this.file = recovered;
        fileState = 'last-valid';
      }
    }
    const diagnostics: DefinitionProblem[] = this.configuration.diagnostics.map((message) => ({
      source: 'workspaces.jsonc',
      level: 'error',
      message,
      line: Number(/at line (\d+)/.exec(message)?.[1]) || undefined,
    }));
    const source = this.file.sources.projectManager;
    if (this.ports.memory?.recovery)
      diagnostics.push({
        source: 'defined-workspaces-v1.json',
        level: 'note',
        message: this.ports.memory.recovery,
      });
    let sourcePath = projectManagerPath(this.home);
    try {
      if (source.path) sourcePath = expandProjectPath(source.path, this.home);
    } catch (error) {
      diagnostics.push({
        source: 'workspaces.jsonc',
        level: 'error',
        message: errorMessage(error),
      });
    }
    if (sourcePath !== this.projectsPath) {
      this.stopSource?.();
      this.projects = undefined;
      this.sourceMissingSince = undefined;
      this.projectsPath = sourcePath;
      this.stopSource = this.stopped
        ? undefined
        : watchFileChanges(sourcePath, () => this.schedule(), 1000);
    }
    let status: DefinitionCatalog['projectManager'] = {
      path: sourcePath,
      state: 'off',
      projects: 0,
      missing: 0,
      disabled: 0,
      remote: 0,
      duplicateKeys: 0,
    };
    if (source.enabled) {
      try {
        await this.ports.access([sourcePath]);
        this.projects = await readProjectManager(sourcePath, this.home);
        this.sourceMissingSince = undefined;
        status = { ...this.projects.status };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'FILE_ACCESS_REQUIRED') status.state = 'needs-access';
        else if (code === 'ENOENT') {
          this.sourceMissingSince ??= Date.now();
          if (this.projects && Date.now() - this.sourceMissingSince < 150) {
            status = { ...this.projects.status, state: 'unreadable' };
            diagnostics.push({
              source: 'projects.json',
              level: 'note',
              message:
                'VS Code Project Manager is temporarily unavailable. The last valid projects remain in effect.',
            });
            this.schedule();
          } else {
            this.projects = undefined;
            status.state = 'absent';
          }
        } else status = { ...(this.projects?.status ?? status), state: 'unreadable' };
        if (status.state === 'unreadable' && code !== 'ENOENT')
          diagnostics.push({
            source: 'projects.json',
            level: 'error',
            message: `${errorMessage(error)}${this.projects ? ' The last valid projects remain in effect.' : ''}`,
          });
      }
    }
    const projects =
      source.enabled && (status.state === 'read' || status.state === 'unreadable')
        ? (this.projects?.projects ?? [])
        : [];
    const settings = this.ports.settings();
    const input = {
      file: this.file,
      projects,
      projectManagerState: status.state,
      home: this.home,
      text: this.configuration.sourceText,
      hash: (text: string) => createHash('sha256').update(text).digest('hex'),
      terminalProfiles: settings.terminals.profiles.map((item) => item.id),
      settingProfiles: [
        ...builtInProfiles.map((item) => item.id),
        ...settings.profiles.map((item) => item.id),
      ],
      rootStates: new Map([...this.roots].map(([root]) => [root, this.rootState(root)])),
    };
    const resolved = resolveCatalog(input);
    this.projectRoots = projects.map((project) => project.root);
    this.wantedRoots = new Set([
      ...resolved.definitions.map((item) => item.root),
      ...this.projectRoots,
    ]);
    for (const root of this.roots.keys()) if (!this.wantedRoots.has(root)) this.roots.delete(root);
    status.missing = this.projectRoots.filter((root) => this.rootState(root) === 'missing').length;
    this.problems = [
      ...diagnostics,
      ...(source.enabled && (status.state === 'read' || status.state === 'unreadable')
        ? (this.projects?.diagnostics ?? [])
        : []),
      ...resolved.diagnostics.filter((issue) => issue.message !== missingDefinitionRoot),
    ];
    this.rootProblems = resolved.rootProblems;
    const previous = new Map(this.current.definitions.map((item) => [item.key, item.openedAt]));
    this.current = {
      revision: this.current.revision + 1,
      file: { path: this.configuration.file, state: fileState },
      projectManager: status,
      definitions: resolved.definitions.map((item) => ({
        ...item,
        openedAt: this.ports.memory?.openedAt(item.key) ?? previous.get(item.key),
        remembered: this.remembered(item.key),
      })),
      diagnostics: [
        ...this.problems,
        ...resolved.diagnostics.filter((issue) => issue.message === missingDefinitionRoot),
      ],
    };
    if (!this.stopped) this.ports.emit(this.snapshot());
    this.scheduleRoots();
  }
  private rootState(root: string): DefinitionRootState {
    const cached = this.roots.get(root);
    return cached && Date.now() - cached.at < 60_000 ? cached.state : 'unknown';
  }
  /** Search and mount changes retry unavailable roots without waiting on a catalog reload. */
  refreshRoots(keys?: readonly string[], owner = 0): void {
    if (keys) this.shownRoots.set(owner, [...keys].slice(0, 50));
    this.scheduleRoots(true);
  }
  searchRoots(query: string, owner: number, limit = 50): void {
    const keys = rankWorkspaceChoices([], this.current.definitions, query, {}, true)
      .slice(0, limit)
      .map((item) => item.key);
    this.refreshRoots(keys, owner);
  }
  clearRootSearch(owner: number): void {
    this.shownRoots.delete(owner);
    this.scheduleRoots();
  }
  async checkRoot(key: string): Promise<DefinitionRootState> {
    const entry = this.entry(key);
    if (!entry) throw new Error('This workspace definition is unavailable.');
    if (this.rootState(entry.root) === 'present') return 'present';
    const value = await this.checkFolder(entry.root);
    this.roots.set(entry.root, { state: value, at: Date.now() });
    this.publishRoots();
    return value;
  }
  private async checkFolder(root: string): Promise<DefinitionRootState> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([
        Promise.resolve()
          .then(() => this.ports.checkRoot(root))
          .catch((): CheckedFolder => ({ directory: false, unavailable: true })),
        new Promise<CheckedFolder>((resolve) => {
          timer = setTimeout(
            () => resolve({ directory: false, unavailable: true, timedOut: true }),
            folderCheckTimeout,
          );
        }),
      ]);
      return value.directory
        ? 'present'
        : value.missing || (!value.unavailable && !value.unchecked && !value.timedOut)
          ? 'missing'
          : 'unknown';
    } finally {
      clearTimeout(timer);
    }
  }
  private scheduleRoots(retry = false): void {
    if (this.stopped) return;
    clearTimeout(this.rootCheck);
    const epoch = ++this.rootEpoch;
    const selected = new Set(
      [...this.shownRoots.values()].flatMap((keys) =>
        keys.flatMap((key) => this.entry(key)?.root ?? []),
      ),
    );
    const roots = [...selected].filter(
      (root) =>
        this.wantedRoots.has(root) &&
        (retry
          ? this.rootState(root) !== 'present'
          : !this.roots.has(root) || this.rootState(root) === 'unknown'),
    );
    // Even a checker that never answers cannot hold the startup or shutdown barrier.
    this.rootCheck = setTimeout(() => {
      void this.checkRoots(roots, epoch);
    }, 0);
  }
  private async checkRoots(roots: readonly string[], epoch: number): Promise<void> {
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(folderCheckConcurrency, roots.length) }, async () => {
        while (!this.stopped && epoch === this.rootEpoch) {
          const root = roots[cursor++];
          if (!root) return;
          const state = await this.checkFolder(root);
          if (this.stopped || epoch !== this.rootEpoch) return;
          this.roots.set(root, { state, at: Date.now() });
          this.rootEmit ??= setTimeout(() => {
            this.rootEmit = undefined;
            this.publishRoots();
          }, 25);
        }
      }),
    );
  }
  private publishRoots(): void {
    if (this.stopped) return;
    let changed = false;
    const definitions = this.current.definitions.map((item) => {
      const rootState = this.rootState(item.root);
      if (item.rootState === rootState) return item;
      changed = true;
      return { ...item, rootState };
    });
    const missing = this.projectRoots.filter((root) => this.rootState(root) === 'missing').length;
    if (!changed && missing === this.current.projectManager.missing) return;
    this.current = {
      ...this.current,
      revision: this.current.revision + 1,
      definitions,
      projectManager: { ...this.current.projectManager, missing },
      diagnostics: [
        ...this.problems,
        ...definitions.flatMap((item) =>
          item.rootState === 'missing' ? (this.rootProblems.get(item.key) ?? []) : [],
        ),
      ],
    };
    this.ports.emit(this.snapshot());
  }
  private remembered(key: string) {
    return this.ports.memory?.summary(key);
  }
  private publishMemory(): void {
    this.current = {
      ...this.current,
      revision: this.current.revision + 1,
      definitions: this.current.definitions.map((item) => ({
        ...item,
        openedAt: this.ports.memory?.openedAt(item.key) ?? item.openedAt,
        remembered: this.remembered(item.key),
      })),
    };
    if (!this.stopped) this.ports.emit(this.snapshot());
  }
  async opened(key: string): Promise<void> {
    const entry = this.entry(key);
    if (!entry) return;
    if (this.ports.memory) {
      await this.ports.memory.opened(key);
      return;
    }
    entry.openedAt = Date.now();
    this.current.revision++;
    this.ports.emit(this.snapshot());
  }
  async edit(): Promise<string> {
    await mkdir(path.dirname(this.configuration.file), { recursive: true, mode: 0o700 });
    try {
      await readFile(this.configuration.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await writeFile(this.configuration.file, starter, { flag: 'wx', mode: 0o600 }).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') throw error;
        },
      );
    }
    await this.reload();
    return this.configuration.file;
  }
  async update(change: (current: WorkspacesFile) => WorkspacesFile): Promise<void> {
    await this.configuration.update((current) =>
      change(current ?? workspacesFileSchema.parse({ version: 1 })),
    );
    await this.reload();
  }
  proposal(workspace: Workspace) {
    return proposeDefinition(workspace, this.current.definitions, this.home);
  }
  async save(
    workspace: Workspace,
    order: readonly string[],
    confirmed: boolean,
    create?: { key: string; name: string },
    assertHuman?: () => void,
  ): Promise<WorkspaceDefinitionReply> {
    const key = create?.key ?? workspace.definition?.key;
    if (!key) throw new Error('Save this workspace as a definition first.');
    definitionKeySchema.parse(key);
    let result: ReturnType<typeof captureDefinition> | undefined;
    let confirmation: WorkspaceDefinitionReply | undefined;
    const needsConfirmation = new Error('Definition confirmation is required.');
    // The callback runs again against disk when an outside edit races the write.
    try {
      await this.configuration.update((document) => {
        assertHuman?.();
        const current = document ?? workspacesFileSchema.parse({ version: 1 });
        const locations = definitionLocations(this.configuration.sourceText);
        const duplicate = locations.diagnostics.find((issue) => issue.key === key);
        if (duplicate) throw new Error('Fix the duplicate key before saving. ' + duplicate.message);
        const source = current.sources.projectManager;
        if (
          source.enabled &&
          (source.path
            ? expandProjectPath(source.path, this.home)
            : projectManagerPath(this.home)) !== this.projectsPath
        )
          throw new Error(
            'The project source changed. Validate workspace definitions before saving.',
          );
        if (create && Object.hasOwn(current.workspaces, key))
          throw new Error('This key already exists. Use Save to definition.');
        const resolved = resolveCatalog({
          file: current,
          projects: source.enabled ? (this.projects?.projects ?? []) : [],
          home: this.home,
          terminalProfiles: this.ports.settings().terminals.profiles.map((item) => item.id),
          settingProfiles: [
            ...builtInProfiles.map((item) => item.id),
            ...this.ports.settings().profiles.map((item) => item.id),
          ],
          hash: (text) => createHash('sha256').update(text).digest('hex'),
        }).definitions;
        let definition = resolved.find((item) => item.key === key);
        const written = Object.hasOwn(current.workspaces, key) ? current.workspaces[key] : {};
        const validated = definitionEntrySchema.safeParse(written);
        if (!validated.success) {
          const issue = validated.error.issues[0]!;
          const issuePath =
            issue.code === 'unrecognized_keys' ? [...issue.path, issue.keys[0]!] : issue.path;
          const line = locations.lineFor(
            key,
            issuePath.filter((part): part is string | number => typeof part !== 'symbol'),
          );
          throw new Error(`Fix ${line ? 'line ' + line + ' of ' : ''}workspaces.jsonc first.`);
        }
        let entry = written as DefinitionEntry;
        if (create) {
          const proposed = this.proposal(workspace);
          const root = definition?.root ?? proposed.root;
          const roots = new Map(
            resolved.filter((item) => item.key !== key).map((item) => [item.key, item.root]),
          );
          entry = {
            name: create.name,
            ...(definition
              ? {}
              : { root: tokenizePath(root, { home: this.home, roots, resolvingRoot: true }) }),
          };
          definition = {
            key,
            root,
            name: create.name,
            basis: '',
            rootState: 'unknown',
            source: definition ? 'override' : 'standalone',
            aliases: [],
            curated: false,
            hidden: false,
            planes: [],
          };
        }
        if (!definition) throw new Error('This workspace definition is unavailable.');
        result = captureDefinition({
          workspace: create ? { ...workspace, definition: undefined } : workspace,
          order,
          definition,
          entry,
          definitions: resolved,
          home: this.home,
          terminalProfile: this.ports.settings().terminals.profileID,
        });
        const changed = workspace.definition?.basis !== definition.basis;
        if (!confirmed && !create && (changed || entry.curated || result.dropsCommands)) {
          confirmation = {
            kind: 'needs-confirmation',
            curated: !!entry.curated,
            dropsCommands: result.dropsCommands,
            ...(changed ? { changed: true } : {}),
          };
          throw needsConfirmation;
        }
        confirmation = undefined;
        return { ...current, workspaces: { ...current.workspaces, [key]: result.entry } };
      });
    } catch (error) {
      if (error === needsConfirmation && confirmation) return confirmation;
      throw error;
    }
    await this.reload();
    const definition = this.entry(key);
    if (!definition || !result) throw new Error('The saved definition could not be resolved.');
    return {
      kind: 'saved',
      key,
      basis: definition.basis,
      planes: result.planes,
      commandPlanes: Object.entries(result.planes).flatMap(([id, index]) => {
        const plane = result!.entry.planes?.[index];
        return plane?.kind === 'terminal' && plane.command !== undefined ? [id] : [];
      }),
      skipped: result.skipped,
      literalPaths: result.literalPaths,
    };
  }
  async close(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.rootCheck);
    clearTimeout(this.rootEmit);
    this.configuration.close();
    this.stopSource?.();
    this.stopVolumes?.();
    this.stopMemory?.();
    await this.queue.catch(() => {});
  }
}
