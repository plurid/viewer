import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir, open, opendir, readFile, realpath } from 'node:fs/promises';
import { z } from 'zod';
import type { FileEntry } from '../../domain/contracts';
import type {
  ActionApproval,
  ActionPlan,
  ActionRecipe,
  ActionRequest,
  DocumentData,
  DocumentEvidence,
  ModelProvider,
  ProposedChange,
} from '../../domain/services';
import type { FileChange } from '../../domain/changes';
import { absolute, entry, exists, validName } from '../filesystem';
import { DocumentStore } from '../document-store';
import { localBookFields } from '../formats';
import type { Operations } from '../operations';
import { fileCoordination } from '../file-coordination';
const output = z.object({
  rows: z
    .array(
      z.object({
        sourceID: z.string(),
        destination: z.string(),
        summary: z.string(),
        fields: z.object({
          year: z.string().nullable(),
          authors: z.string().nullable(),
          title: z.string().nullable(),
          publisher: z.string().nullable(),
        }),
        evidence: z
          .array(
            z.object({
              field: z.enum([
                'year',
                'authors',
                'title',
                'publisher',
                'name',
                'destination',
                'summary',
              ]),
              source: z.string(),
              text: z.string(),
            }),
          )
          .max(20),
      }),
    )
    .max(2000),
});
const compact = (value: string) => value.replace(/\s+/g, ' ').trim();
const contained = (file: string, root: string) =>
  file === root || file.startsWith(root.replace(/\/$/, '') + '/');
const same = (a: FileEntry, b: FileEntry) =>
  a.identity === b.identity && a.size === b.size && a.modified === b.modified && a.kind === b.kind;
interface Dependencies {
  access?(files: readonly string[]): Promise<void>;
  recipes(): ActionRecipe[];
  providers(): ModelProvider[];
  extract(file: string, signal: AbortSignal): Promise<DocumentData>;
  generate(
    provider: ModelProvider,
    instructions: string,
    input: unknown,
    schema: Record<string, unknown>,
    signal: AbortSignal,
    level: ActionRecipe['data'],
  ): Promise<unknown>;
  operations: Pick<Operations, 'exclusive'>;
  emit(plan: ActionPlan): void;
  changed(changes: FileChange[]): void;
}
const sourceSchema = z.object({
  path: z.string(),
  name: z.string(),
  parent: z.string(),
  extension: z.string(),
  kind: z.enum(['file', 'directory', 'symlink', 'other']),
  directory: z.boolean(),
  size: z.number().min(0),
  modified: z.number(),
  created: z.number(),
  hidden: z.boolean(),
  mime: z.string(),
  identity: z.string(),
  linkTarget: z.string().optional(),
  error: z.string().optional(),
});
const stepSchema = z.object({
  row: z.string(),
  stagedPath: z.string().optional(),
  completed: z.boolean().optional(),
});
const planSchema = z.object({
  id: z.string(),
  revision: z.number(),
  recipeID: z.string(),
  title: z.string(),
  context: z.object({
    workspaceID: z.string(),
    rootID: z.string(),
    paneID: z.string(),
    sources: z.array(z.string()).max(2000),
    actor: z.enum(['user', 'agent']),
    recursive: z.boolean().optional(),
  }),
  status: z.enum([
    'planning',
    'review',
    'applying',
    'completed',
    'partial',
    'cancelled',
    'failed',
    'recovery',
  ]),
  rows: z
    .array(
      z.object({
        id: z.string(),
        source: sourceSchema.optional(),
        kind: z.enum(['rename', 'move', 'mkdir', 'summary']),
        destination: z.string(),
        text: z.string().optional(),
        evidence: z.array(z.object({ source: z.string(), text: z.string() })),
        issue: z.string().optional(),
        approved: z.boolean(),
        completed: z.boolean().optional(),
        stagedPath: z.string().optional(),
        error: z.string().optional(),
      }),
    )
    .max(4000),
  outputRoot: z.string().optional(),
  summary: z.string().optional(),
  summaryInputs: z.array(sourceSchema).max(2000).optional(),
  error: z.string().optional(),
  undoable: z.boolean(),
});
export class ActionPlanner {
  private closed = false;
  private starting = new Set<Promise<string>>();
  private plans = new Map<string, ActionPlan>();
  private aborts = new Map<string, AbortController>();
  private work = new Map<string, Promise<unknown>>();
  private store: DocumentStore<ActionPlan[]>;
  private loaded?: Promise<void>;
  private lastProgress = new Map<string, number>();
  private planning: Promise<void> = Promise.resolve();
  constructor(
    private dataPath: string,
    private dependencies: Dependencies,
  ) {
    this.store = new DocumentStore(
      path.join(dataPath, 'action-journal-v1.json'),
      (value) => z.array(planSchema).max(100).parse(value) as ActionPlan[],
    );
  }
  async load(): Promise<void> {
    this.loaded ??= this.store.load().then(async (plans) => {
      for (const plan of plans || []) {
        if (['planning', 'applying'].includes(plan.status)) {
          if (plan.status === 'applying') {
            const journal = await readFile(this.stepFile(plan.id), 'utf8').catch((error) => {
              if (error.code === 'ENOENT') return '';
              throw error;
            });
            if (journal.length > 4000000)
              throw new Error('Action recovery log exceeded its limit.');
            const lines = journal.split('\n');
            for (let index = 0; index < lines.length; index++) {
              if (!lines[index]) continue;
              try {
                const step = stepSchema.parse(JSON.parse(lines[index]));
                const row = plan.rows.find((row) => row.id === step.row);
                if (row) {
                  row.stagedPath = step.stagedPath;
                  row.completed = step.completed;
                }
              } catch (error) {
                if (index !== lines.length - 1) throw error;
              }
            }
          }
          plan.status = 'recovery';
          plan.error =
            'Interrupted task. Review its recorded paths before restoring or continuing.';
          plan.undoable = false;
        }
        this.plans.set(plan.id, plan);
      }
    });
    await this.loaded;
  }
  private stepFile(id: string) {
    return path.join(this.dataPath, 'action-steps-' + id + '.jsonl');
  }
  private async checkpoint(plan: ActionPlan, row: ProposedChange) {
    const handle = await open(this.stepFile(plan.id), 'a', 0o600);
    try {
      await handle.writeFile(
        JSON.stringify({ row: row.id, stagedPath: row.stagedPath, completed: row.completed }) +
          '\n',
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (Date.now() - (this.lastProgress.get(plan.id) || 0) > 100) {
      this.lastProgress.set(plan.id, Date.now());
      await this.publish(plan, false);
    }
  }
  async all(): Promise<ActionPlan[]> {
    await this.load();
    return [...this.plans.values()].map((plan) => structuredClone(plan));
  }
  async get(id: string): Promise<ActionPlan> {
    await this.load();
    const plan = this.plans.get(id);
    if (!plan) throw new Error('This proposal is unavailable.');
    return structuredClone(plan);
  }
  private async publish(plan: ActionPlan, durable = true) {
    plan.revision++;
    this.plans.set(plan.id, plan);
    this.dependencies.emit(structuredClone(plan));
    if (durable) await this.store.save([...this.plans.values()].slice(-100));
  }
  start(request: ActionRequest): Promise<string> {
    if (this.closed) return Promise.reject(new Error('Actions have closed.'));
    const work = this.create(request).finally(() => this.starting.delete(work));
    this.starting.add(work);
    return work;
  }
  private async create(request: ActionRequest): Promise<string> {
    await this.load();
    await this.dependencies.access?.(request.context.sources);
    if (this.closed) throw new Error('Actions have closed.');
    const recipe = this.dependencies.recipes().find((recipe) => recipe.id === request.recipeID);
    if (!recipe) throw new Error('This action recipe is unavailable.');
    if (!request.context.sources.length) throw new Error('Select files or a folder first.');
    if (this.plans.size >= 100)
      for (const [id, old] of this.plans) {
        if (this.plans.size < 100) break;
        if (['completed', 'failed', 'cancelled'].includes(old.status)) {
          this.plans.delete(id);
        }
      }
    if (this.plans.size >= 100)
      throw new Error('Review or finish existing tasks before starting another.');
    const plan: ActionPlan = {
      id: randomUUID(),
      revision: 0,
      recipeID: recipe.id,
      title: recipe.name,
      context: structuredClone(request.context),
      status: 'planning',
      rows: [],
      undoable: false,
    };
    const abort = new AbortController();
    this.aborts.set(plan.id, abort);
    await this.publish(plan);
    const work = this.planning
      .catch(() => {})
      .then(() => this.plan(plan, recipe, request, abort.signal))
      .catch(async (error) => {
        plan.status = abort.signal.aborted ? 'cancelled' : 'failed';
        plan.error = error instanceof Error ? error.message : String(error);
        await this.publish(plan);
      })
      .finally(() => {
        this.aborts.delete(plan.id);
        this.work.delete(plan.id);
      });
    this.planning = work.then(
      () => {},
      () => {},
    );
    this.work.set(plan.id, work);
    return plan.id;
  }
  async settled(id: string): Promise<void> {
    await this.work.get(id);
  }
  cancel(id: string): void {
    this.aborts.get(id)?.abort();
  }
  async quiesce(root: string): Promise<void> {
    const related = (file: string) =>
      file === root || file.startsWith(root.replace(/\/$/, '') + '/');
    const work: Promise<unknown>[] = [];
    for (const [id, plan] of this.plans)
      if (
        plan.context.sources.some(related) ||
        plan.rows.some(
          (row) => (row.source && related(row.source.path)) || related(row.destination),
        )
      ) {
        this.cancel(id);
        const pending = this.work.get(id);
        if (pending) work.push(pending);
      }
    await Promise.allSettled(work);
  }
  private async collect(
    request: ActionRequest,
    recipe: ActionRecipe,
    signal: AbortSignal,
  ): Promise<FileEntry[]> {
    const result = new Map<string, FileEntry>();
    const folders: string[] = [];
    for (const source of request.context.sources) {
      const item = await entry(absolute(source));
      if (item.kind === 'symlink' || item.kind === 'other') continue;
      if (item.directory) folders.push(item.path);
      else result.set(item.path, item);
    }
    let visited = 0;
    for (let cursor = 0; cursor < folders.length; cursor++) {
      signal.throwIfAborted();
      const folder = await opendir(folders[cursor]);
      for await (const child of folder) {
        signal.throwIfAborted();
        if (++visited > 100000)
          throw new Error(
            'The selected tree exceeds the action scan limit. Select a smaller folder.',
          );
        if (child.name.startsWith('.') || child.isSymbolicLink()) continue;
        const item = await entry(path.join(folders[cursor], child.name));
        if (item.directory) {
          if (request.context.recursive ?? recipe.recursive) folders.push(item.path);
        } else if (item.kind === 'file') result.set(item.path, item);
        if (result.size > 2000) throw new Error('Choose at most 2,000 files per action.');
      }
    }
    return [...result.values()]
      .filter((item) => !recipe.formats.length || recipe.formats.includes(item.extension))
      .sort((a, b) => a.path.localeCompare(b.path));
  }
  private row(
    source: FileEntry,
    destination: string,
    evidence: DocumentEvidence[] = [],
    issue?: string,
  ): ProposedChange {
    return {
      id: randomUUID(),
      source,
      kind: source.parent === path.dirname(destination) ? 'rename' : 'move',
      destination,
      evidence,
      issue,
      approved: !issue,
    };
  }
  private async plan(
    plan: ActionPlan,
    recipe: ActionRecipe,
    request: ActionRequest,
    signal: AbortSignal,
  ): Promise<void> {
    const files = await this.collect(request, recipe, signal);
    if (!files.length) throw new Error('No supported files were found in the selection.');
    if (recipe.kind === 'summarize') plan.summaryInputs = files;
    if (recipe.kind === 'batch-rename') {
      plan.rows = files.map((file, index) => {
        const extension = path.extname(file.name);
        let name = file.name.slice(0, file.name.length - extension.length);
        if (request.options?.find)
          name = name.split(request.options.find).join(request.options.replace || '');
        name = (request.options?.prefix || '') + name + (request.options?.suffix || '');
        name = (request.options?.template || recipe.template)
          .replace(/\{name\}/g, name)
          .replace(/\{extension\}/g, extension)
          .replace(/\{number\}/g, String((request.options?.start ?? 1) + index));
        return this.row(file, path.join(file.parent, name));
      });
    } else {
      const provider = this.dependencies
        .providers()
        .find((provider) => provider.id === recipe.providerID);
      if (recipe.kind !== 'book-name' && !provider)
        throw new Error('Choose a model provider for this recipe in Settings.');
      const documents = new Map<string, DocumentData>();
      for (const file of files) {
        signal.throwIfAborted();
        if (recipe.data !== 'names' || recipe.kind === 'book-name') {
          try {
            documents.set(file.path, await this.dependencies.extract(file.path, signal));
          } catch (error) {
            if (signal.aborted) throw error;
            documents.set(file.path, {
              path: file.path,
              text: '',
              metadata: {},
              evidence: [],
              truncated: true,
            });
          }
        }
      }
      if (!provider) {
        plan.rows = files.map((file) => {
          const document = documents.get(file.path)!;
          const fields = localBookFields(document);
          const unresolved = ['year', 'authors', 'title', 'publisher'].filter(
            (key) => !fields[key],
          );
          const name = recipe.template.replace(
            /\{(year|authors|title|publisher|extension)\}/g,
            (_all, key) =>
              key === 'extension' ? path.extname(file.name) : fields[key] || '[' + key + ']',
          );
          return this.row(
            file,
            path.join(file.parent, name),
            document.evidence.filter((item) => !item.source.startsWith('chapter:')).slice(0, 20),
            unresolved.length
              ? 'Missing ' + unresolved.join(', ') + '. Edit the name or configure a model.'
              : undefined,
          );
        });
      } else {
        const input = files.map((file, index) => ({
          sourceID: String(index),
          filename: file.name,
          extension: path.extname(file.name),
          metadata: recipe.data === 'names' ? {} : documents.get(file.path)?.metadata,
          evidence:
            recipe.data === 'names'
              ? []
              : documents
                  .get(file.path)
                  ?.evidence.map((item) => ({
                    ...item,
                    text: item.text.slice(0, recipe.data === 'excerpts' ? 6000 : 20000),
                  }))
                  .slice(0, recipe.data === 'excerpts' ? 16 : 64),
        }));
        if (JSON.stringify(input).length > 500000)
          throw new Error('This batch contains too much document evidence. Select fewer files.');
        const response = output.parse(
          await this.dependencies.generate(
            provider,
            recipe.instructions +
              '\n' +
              (request.instructions || '') +
              '\nFor books return year, authors, title and publisher with a quote for each. For organize return a relative destination inside the existing parent directory. For rename return a filename. For summarize return a summary. Return exactly one row per sourceID.',
            input,
            z.toJSONSchema(output) as Record<string, unknown>,
            signal,
            recipe.data,
          ),
        );
        const ids = new Set<string>();
        for (const proposed of response.rows) {
          if (ids.has(proposed.sourceID))
            throw new Error('The model proposed the same file twice.');
          ids.add(proposed.sourceID);
          const index = Number(proposed.sourceID);
          const file = files[index];
          if (!file || String(index) !== proposed.sourceID)
            throw new Error('The model proposed an unknown file.');
          const document = documents.get(file.path);
          const evidence = proposed.evidence.map((item) => ({
            source: item.field + ' · ' + item.source,
            text: item.text,
          }));
          const proven = proposed.evidence.every(
            (item) =>
              item.text.trim() &&
              document?.evidence.some(
                (source) =>
                  source.source === item.source &&
                  compact(source.text).includes(compact(item.text)),
              ),
          );
          if (recipe.kind === 'summarize') {
            plan.summary = (plan.summary || '') + '\n\n## ' + file.name + '\n\n' + proposed.summary;
            continue;
          }
          let name = proposed.destination;
          let issue: string | undefined;
          if (recipe.kind === 'book-name') {
            const missing = ['year', 'authors', 'title', 'publisher'].filter(
              (key) =>
                !proposed.fields[key as keyof typeof proposed.fields] ||
                !proposed.evidence.some((item) => item.field === key),
            );
            name = recipe.template.replace(
              /\{(year|authors|title|publisher|extension)\}/g,
              (_all, key) =>
                key === 'extension'
                  ? path.extname(file.name)
                  : proposed.fields[key as keyof typeof proposed.fields] || '[' + key + ']',
            );
            if (missing.length || !proven)
              issue = 'Unresolved publication evidence. Review and edit the name.';
          }
          if (recipe.kind !== 'organize' && path.basename(name) !== name)
            issue = 'Rename must contain only a filename.';
          if (path.extname(name) !== path.extname(file.name))
            issue = 'Keep the original extension.';
          const destination = path.resolve(file.parent, name);
          if (!contained(destination, file.parent))
            issue = 'The destination is outside this action’s scope.';
          plan.rows.push(this.row(file, destination, evidence, issue));
        }
        if (ids.size !== files.length)
          throw new Error('The model omitted files. Retry with a smaller batch.');
      }
    }
    signal.throwIfAborted();
    await this.checkRows(plan.rows);
    plan.status = 'review';
    await this.publish(plan);
  }
  private async checkRows(rows: ProposedChange[]): Promise<void> {
    const sources = new Set(rows.flatMap((row) => row.source?.path || []));
    const targets = new Map<string, ProposedChange>();
    for (const row of rows) {
      try {
        validName(path.basename(row.destination));
        if (Buffer.byteLength(path.basename(row.destination), 'utf8') > 255)
          throw new Error('The filename is too long.');
      } catch (error) {
        row.issue = (error as Error).message;
      }
      const key = row.destination.normalize('NFC').toLowerCase();
      const duplicate = targets.get(key);
      if (duplicate) {
        row.issue = 'Two files have the same destination.';
        duplicate.issue = row.issue;
        duplicate.approved = false;
      }
      targets.set(key, row);
      if (await exists(row.destination)) {
        const destination = await entry(row.destination);
        if (
          !sources.has(row.destination) &&
          (destination.identity !== row.source?.identity ||
            row.destination.toLowerCase() !== row.source?.path.toLowerCase())
        )
          row.issue = 'The destination already exists. Edit the name.';
      }
      if (row.source?.path === row.destination) row.issue = 'The filename is unchanged.';
      if (row.issue) row.approved = false;
    }
  }
  private async scope(destination: string, source?: FileEntry, roots?: string[]): Promise<void> {
    absolute(destination);
    validName(path.basename(destination));
    if (Buffer.byteLength(path.basename(destination), 'utf8') > 255)
      throw new Error('The filename is too long.');
    let parent = path.dirname(destination);
    while (!(await exists(parent))) {
      const next = path.dirname(parent);
      if (next === parent) throw new Error('The destination has no accessible parent.');
      parent = next;
    }
    const actual = await realpath(parent);
    const allowed = source
      ? [await realpath(source.parent)]
      : await Promise.all((roots || []).map((root) => realpath(root)));
    if (!allowed.some((root) => contained(actual, root)))
      throw new Error('The destination escapes the selected file scope through a symbolic link.');
  }
  async apply(approval: ActionApproval): Promise<void> {
    await this.load();
    if (this.closed) throw new Error('Actions have closed.');
    const plan = this.plans.get(approval.id);
    if (!plan || plan.revision !== approval.revision || plan.status !== 'review')
      throw new Error('This proposal changed. Review its current version.');
    const updated = plan.rows.map((row) => {
      const edit = approval.rows.find((item) => item.id === row.id);
      return edit
        ? {
            ...row,
            destination: absolute(edit.destination),
            approved: edit.approved,
            issue: edit.destination !== row.destination ? undefined : row.issue,
          }
        : { ...row, approved: false };
    });
    for (const edit of approval.rows)
      if (!plan.rows.some((row) => row.id === edit.id)) throw new Error('Unknown proposal row.');
    const selected = updated.filter((row) => row.approved);
    if (!selected.length) throw new Error('Select at least one change.');
    await this.dependencies.access?.([
      ...plan.context.sources,
      ...selected.flatMap((row) => [row.destination, ...(row.source ? [row.source.path] : [])]),
    ]);
    if (selected.some((row) => row.kind === 'summary')) await this.validateSummary(plan);
    await this.checkRows(selected);
    if (selected.some((row) => row.issue)) {
      plan.rows = updated;
      await this.publish(plan);
      throw new Error('Resolve the selected conflicts before applying.');
    }
    for (const row of selected) {
      if (row.source && !same(row.source, await entry(row.source.path)))
        throw new Error('A source changed after planning. Run the action again.');
      await this.scope(
        row.destination,
        row.source,
        plan.outputRoot
          ? [plan.outputRoot]
          : plan.context.sources.map((source) => path.dirname(source)),
      );
    }
    plan.rows = updated;
    plan.status = 'applying';
    const abort = new AbortController();
    this.aborts.set(plan.id, abort);
    await this.publish(plan);
    const work = this.dependencies.operations
      .exclusive(async (publish) => {
        const changes: FileChange[] = [];
        try {
          if (selected.some((row) => row.kind === 'summary')) await this.validateSummary(plan);
          for (const row of selected) {
            abort.signal.throwIfAborted();
            if (row.source && !same(row.source, await entry(row.source.path)))
              throw new Error('A source changed before its operation.');
          }
          // Stage the complete selection first, allowing cycles and case-only renames.
          for (const row of selected) {
            abort.signal.throwIfAborted();
            if (!row.source) continue;
            if (!same(row.source, await entry(row.source.path)))
              throw new Error('A source changed immediately before its operation.');
            row.stagedPath = path.join(row.source.parent, '.viewer-action-' + randomUUID());
            await this.checkpoint(plan, row);
            await publish(
              row.source.path,
              row.stagedPath,
              async () => {
                abort.signal.throwIfAborted();
                if (!same(row.source!, await entry(row.source!.path)))
                  throw new Error('A source changed while waiting for its file provider.');
              },
              abort.signal,
            );
            await this.checkpoint(plan, row);
          }
          for (const row of selected) {
            abort.signal.throwIfAborted();
            await this.scope(
              row.destination,
              row.source,
              plan.outputRoot
                ? [plan.outputRoot]
                : plan.context.sources.map((source) => path.dirname(source)),
            );
            if (!(await exists(path.dirname(row.destination))))
              await fileCoordination.run(
                [{ path: path.dirname(row.destination), mode: 'write' }],
                async (signal) => {
                  signal?.throwIfAborted();
                  await this.scope(
                    row.destination,
                    row.source,
                    plan.outputRoot
                      ? [plan.outputRoot]
                      : plan.context.sources.map((source) => path.dirname(source)),
                  );
                  await mkdir(fileCoordination.path(path.dirname(row.destination)), {
                    recursive: true,
                  });
                },
                abort.signal,
              );
            if (row.source) {
              const staged = await entry(row.stagedPath!);
              if (!same(row.source, staged))
                throw new Error('A staged source changed; it was preserved for recovery.');
              await publish(
                row.stagedPath!,
                row.destination,
                async () => {
                  abort.signal.throwIfAborted();
                  if (!same(row.source!, await entry(row.stagedPath!)))
                    throw new Error('A staged source changed while waiting for its file provider.');
                },
                abort.signal,
              );
              changes.push({ source: row.source.path, destination: row.destination });
            } else
              await fileCoordination.run(
                [{ path: row.destination, mode: 'write' }],
                async (signal) => {
                  signal?.throwIfAborted();
                  await this.scope(
                    row.destination,
                    row.source,
                    plan.outputRoot
                      ? [plan.outputRoot]
                      : plan.context.sources.map((source) => path.dirname(source)),
                  );
                  if (row.kind === 'summary') {
                    await this.validateSummary(plan);
                    const handle = await open(fileCoordination.path(row.destination), 'wx', 0o600);
                    try {
                      await handle.writeFile(row.text || '');
                      await handle.sync();
                    } finally {
                      await handle.close();
                    }
                  } else if (row.kind === 'mkdir')
                    await mkdir(fileCoordination.path(row.destination));
                  signal?.throwIfAborted();
                },
                abort.signal,
              );
            row.completed = true;
            row.stagedPath = undefined;
            await this.checkpoint(plan, row);
          }
          plan.status = 'completed';
          plan.undoable = selected.every((row) => !!row.source);
        } catch (error) {
          plan.error = error instanceof Error ? error.message : String(error);
          // Restore only to free original paths; never overwrite a concurrent file.
          for (const row of selected)
            if (row.stagedPath && (await exists(row.stagedPath)) && row.source) {
              try {
                if (
                  !(await exists(row.source.path)) &&
                  same(row.source, await entry(row.stagedPath))
                ) {
                  await publish(row.stagedPath, row.source.path);
                  row.stagedPath = undefined;
                }
              } catch {
                /* The durable journal retains the surviving staging path. */
              }
            }
          plan.status = selected.some((row) => row.completed || row.stagedPath)
            ? 'partial'
            : abort.signal.aborted
              ? 'cancelled'
              : 'failed';
          plan.undoable = false;
        } finally {
          if (changes.length) this.dependencies.changed(changes);
          await this.publish(plan);
        }
      })
      .finally(() => {
        this.aborts.delete(plan.id);
        this.work.delete(plan.id);
      });
    this.work.set(plan.id, work);
    await work;
  }
  async undo(id: string): Promise<void> {
    if (this.closed) throw new Error('Actions have closed.');
    const plan = this.plans.get(id);
    if (!plan?.undoable || plan.status !== 'completed')
      throw new Error('This task cannot be undone.');
    await this.dependencies.access?.(
      plan.rows
        .filter((row) => row.completed)
        .flatMap((row) => [row.destination, ...(row.source ? [row.source.path] : [])]),
    );
    for (const row of plan.rows.filter((row) => row.completed && row.source)) {
      const current = await entry(row.destination);
      if (!same(row.source!, current))
        throw new Error('A completed file changed. Undo is unavailable.');
    }
    const reverse: ActionPlan = {
      ...structuredClone(plan),
      id: randomUUID(),
      revision: 0,
      title: 'Undo ' + plan.title,
      status: 'review',
      undoable: false,
      rows: await Promise.all(
        plan.rows
          .filter((row) => row.completed && row.source)
          .map(async (row) => this.row(await entry(row.destination), row.source!.path)),
      ),
    };
    await this.publish(reverse);
    await this.apply({
      id: reverse.id,
      revision: reverse.revision,
      rows: reverse.rows.map((row) => ({
        id: row.id,
        destination: row.destination,
        approved: true,
      })),
    });
    if (reverse.status === 'completed') {
      plan.undoable = false;
      await this.publish(plan);
    }
  }
  private async validateSummary(plan: ActionPlan): Promise<void> {
    if (!plan.summaryInputs?.length)
      throw new Error('This summary has no recorded sources. Run the action again.');
    for (const file of plan.summaryInputs)
      if (!same(file, await entry(file.path)))
        throw new Error('A summary source changed. Run the action again.');
  }
  async exportSummary(id: string, destination: string): Promise<void> {
    await this.load();
    const plan = this.plans.get(id);
    if (!plan?.summary || plan.status !== 'review') throw new Error('This summary is unavailable.');
    await this.dependencies.access?.([...plan.context.sources, destination]);
    await this.validateSummary(plan);
    if (await exists(destination)) throw new Error('Choose a new summary filename.');
    plan.outputRoot = path.dirname(absolute(destination));
    plan.rows = [
      {
        id: randomUUID(),
        kind: 'summary',
        destination: absolute(destination),
        text: plan.summary,
        approved: true,
        evidence: [],
      },
    ];
    await this.publish(plan);
  }
  async recovery(id: string): Promise<void> {
    if (this.closed) throw new Error('Actions have closed.');
    const plan = this.plans.get(id);
    if (!plan || !['partial', 'recovery'].includes(plan.status))
      throw new Error('This task does not need recovery.');
    await this.dependencies.access?.(
      plan.rows.flatMap((row) => [
        row.destination,
        ...(row.source ? [row.source.path] : []),
        ...(row.stagedPath ? [row.stagedPath] : []),
      ]),
    );
    const rows: ProposedChange[] = [];
    for (const row of plan.rows)
      if (row.source) {
        const current =
          row.stagedPath && (await exists(row.stagedPath))
            ? row.stagedPath
            : (row.completed || row.stagedPath) && (await exists(row.destination))
              ? row.destination
              : undefined;
        if (current) {
          const item = await entry(current);
          if (!same(row.source, item))
            throw new Error('A recorded file changed. Inspect its path before recovery.');
          rows.push(
            this.row(item, row.source.path, [{ source: 'Recovery journal', text: current }]),
          );
        }
      }
    if (!rows.length) throw new Error('No movable files were recorded for recovery.');
    const review: ActionPlan = {
      ...structuredClone(plan),
      id: randomUUID(),
      revision: 0,
      title: 'Restore ' + plan.title,
      status: 'review',
      rows,
      undoable: false,
      error: undefined,
    };
    await this.checkRows(rows);
    await this.publish(review);
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const abort of this.aborts.values()) abort.abort();
    await Promise.allSettled(this.starting);
    for (const abort of this.aborts.values()) abort.abort();
    await Promise.allSettled(this.work.values());
    await this.store.flush();
  }
}
