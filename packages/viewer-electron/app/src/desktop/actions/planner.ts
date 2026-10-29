import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir, open, opendir, readFile, realpath, rename } from 'node:fs/promises';
import { z } from 'zod';
import { fileEntrySchema } from '../schemas';
import { recipeReadsContent, requestActors } from '../../domain/services';
import { absolute, entry, exists, validName } from '../files/filesystem';
import { DocumentStore } from '../persistence/document-store';
import { renameNames } from '../../domain/operations/batch-rename';
import { fileCoordination } from '../files/file-coordination';
import { errorMessage } from '../../domain/errors';
import { removePrivateData } from '../operations/removal';
import { containsPath } from '../files/containment';
import {
  localPublication,
  mergeApproval,
  modelInput,
  modelInstructions,
  modelResponse,
  reviewModelRows,
  stoppedStatus,
} from './proposals';
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
  RequestActor,
} from '../../domain/services';
import type { FileChange } from '../../domain/files/changes';
import type { RenameInput } from '../../domain/operations/batch-rename';
import type { Operations } from '../operations/operations';
const same = (a: FileEntry, b: FileEntry) =>
  a.identity === b.identity && a.size === b.size && a.modified === b.modified && a.kind === b.kind;
interface Dependencies {
  rename?(input: RenameInput, signal: AbortSignal): Promise<string[]>;
  snapshot?(title: string, sources: string[], signal: AbortSignal): Promise<string>;
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
    /** Who started it: an agent's action needs the data approved for agents too. */
    actor: RequestActor,
  ): Promise<unknown>;
  operations: Pick<Operations, 'exclusive'>;
  emit(plan: ActionPlan): void;
  changed(changes: FileChange[]): void;
}
type Publish = Parameters<Parameters<Operations['exclusive']>[0]>[0];
/** One plan being prepared for review. */
interface Planning {
  plan: ActionPlan;
  recipe: ActionRecipe;
  request: ActionRequest;
  signal: AbortSignal;
}
/** One approved selection being applied, inside the operation service's exclusive work. */
interface Applying {
  plan: ActionPlan;
  selected: ProposedChange[];
  publish: Publish;
  signal: AbortSignal;
}
const stepSchema = z.object({
  row: z.string(),
  stagedPath: z.string().optional(),
  completed: z.boolean().optional(),
});
const planSchema = z.object({
  version: z.literal(1).default(1),
  checkpointID: z.string().optional(),
  id: z.string(),
  revision: z.number(),
  recipeID: z.string(),
  title: z.string(),
  context: z.object({
    workspaceID: z.string(),
    rootID: z.string(),
    paneID: z.string(),
    sources: z.array(z.string()).max(2000),
    actor: z.enum(requestActors),
    clientID: z.string().max(200).optional(),
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
        source: fileEntrySchema.optional(),
        kind: z.enum(['rename', 'move', 'mkdir', 'summary']),
        destination: z.string(),
        text: z.string().optional(),
        evidence: z.array(z.object({ source: z.string(), text: z.string() })),
        issue: z.string().optional(),
        approved: z.boolean(),
        completed: z.boolean().optional(),
        stagedPath: z.string().optional(),
        scopeRoot: z.string().optional(),
        restoration: z.object({ destination: z.string(), root: z.string() }).optional(),
        error: z.string().optional(),
      }),
    )
    .max(4000),
  outputRoot: z.string().optional(),
  summary: z.string().optional(),
  summaryInputs: z.array(fileEntrySchema).max(2000).optional(),
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
    // A failed read is tried again by the next call; kept, it disabled Actions until a restart,
    // and every Actions call awaits it.
    this.loaded ??= this.restore().catch((error) => {
      this.loaded = undefined;
      throw error;
    });
    await this.loaded;
  }
  private async restore(): Promise<void> {
    const applying = new Set<string>();
    for (const plan of (await this.store.load()) || []) {
      if (['planning', 'applying'].includes(plan.status)) {
        plan.error = 'Interrupted task. Review its recorded paths before restoring or continuing.';
        if (plan.status === 'applying') {
          applying.add(plan.id);
          // One unreadable log is set aside for inspection, as the operation log does; it
          // rejected the whole load, and with it every plan.
          await this.recoverSteps(plan).catch(async (error: Error) => {
            const kept = `${this.stepFile(plan.id)}.unreadable-${Date.now()}`;
            const moved = await rename(this.stepFile(plan.id), kept).then(
              () => true,
              () => false,
            );
            plan.error =
              'Interrupted task. Its recovery log could not be read' +
              (moved ? `, so it was kept at ${kept}` : '') +
              `. Check the recorded paths yourself before restoring or continuing. (${error.message})`;
          });
        }
        plan.status = 'recovery';
        plan.undoable = false;
      }
      this.plans.set(plan.id, plan);
    }
    await this.sweepSteps(applying);
  }
  private async recoverSteps(plan: ActionPlan): Promise<void> {
    const journal = await readFile(this.stepFile(plan.id), 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    if (journal.length > 4000000) throw new Error('Action recovery log exceeded its limit.');
    const lines = journal.split('\n');
    for (const [index, line] of lines.entries()) {
      if (!line) continue;
      try {
        const step = stepSchema.parse(JSON.parse(line));
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
  /** Only a plan recorded as applying reads its step log, on recovery; any other log is spent
   * private data, which was never removed. A set-aside log is kept. */
  private async sweepSteps(applying: ReadonlySet<string>): Promise<void> {
    const directory = await opendir(this.dataPath).catch(() => undefined);
    if (!directory) return;
    for await (const item of directory) {
      const id = /^action-steps-(.+)\.jsonl$/.exec(item.name)?.[1];
      if (!id || !item.isFile() || applying.has(id)) continue;
      await removePrivateData(this.dataPath, path.join(this.dataPath, item.name)).catch(() => {});
    }
  }
  private stepFile(id: string) {
    return path.join(this.dataPath, 'action-steps-' + id + '.jsonl');
  }
  private async recordStep(plan: ActionPlan, row: ProposedChange) {
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
  start(
    request: ActionRequest,
    expectedRecipe?: ActionRecipe,
    signal?: AbortSignal,
  ): Promise<string> {
    if (this.closed) return Promise.reject(new Error('Actions have closed.'));
    const work = this.create(request, expectedRecipe, signal).finally(() =>
      this.starting.delete(work),
    );
    this.starting.add(work);
    return work;
  }
  private async create(
    request: ActionRequest,
    expectedRecipe?: ActionRecipe,
    signal?: AbortSignal,
  ): Promise<string> {
    signal?.throwIfAborted();
    await this.load();
    signal?.throwIfAborted();
    await this.dependencies.access?.(request.context.sources);
    signal?.throwIfAborted();
    if (this.closed) throw new Error('Actions have closed.');
    const recipe = this.dependencies.recipes().find((recipe) => recipe.id === request.recipeID);
    if (!recipe) throw new Error('This action recipe is unavailable.');
    if (expectedRecipe && JSON.stringify(recipe) !== JSON.stringify(expectedRecipe))
      throw new Error('The recipe changed after approval. Review the workflow rule again.');
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
      version: 1,
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
    const cancel = () => abort.abort(signal?.reason);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    this.aborts.set(plan.id, abort);
    try {
      await this.publish(plan);
    } catch (error) {
      signal?.removeEventListener('abort', cancel);
      this.aborts.delete(plan.id);
      plan.status = 'failed';
      plan.error = errorMessage(error);
      throw error;
    }
    const work = this.planning
      .catch(() => {})
      .then(() => this.plan({ plan, recipe, request, signal: abort.signal }))
      .catch(async (error) => {
        plan.status = abort.signal.aborted ? 'cancelled' : 'failed';
        plan.error = errorMessage(error);
        await this.publish(plan);
      })
      .finally(() => {
        signal?.removeEventListener('abort', cancel);
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
    const plan = this.plans.get(id);
    if (plan?.status === 'review') {
      plan.status = 'cancelled';
      void this.publish(plan).catch(() => {});
    }
  }
  async quiesce(root: string): Promise<void> {
    const related = (file: string) => containsPath(root, file);
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
    // New subfolders are appended while this loop runs; `for…of` visits them too.
    for (const current of folders) {
      signal.throwIfAborted();
      const folder = await opendir(current);
      for await (const child of folder) {
        signal.throwIfAborted();
        if (++visited > 100000)
          throw new Error(
            'The selected tree exceeds the action scan limit. Select a smaller folder.',
          );
        if (child.name.startsWith('.') || child.isSymbolicLink()) continue;
        const item = await entry(path.join(current, child.name));
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
  private async plan(planning: Planning): Promise<void> {
    const { plan, recipe, request, signal } = planning;
    signal.throwIfAborted();
    const files = await this.collect(request, recipe, signal);
    if (!files.length) throw new Error('No supported files were found in the selection.');
    if (recipe.kind === 'summarize') plan.summaryInputs = files;
    if (recipe.kind === 'batch-rename') plan.rows = await this.planRename(planning, files);
    else await this.planDocuments(planning, files);
    signal.throwIfAborted();
    await this.offerForReview(plan);
  }
  private async planRename(
    { recipe, request, signal }: Planning,
    files: FileEntry[],
  ): Promise<ProposedChange[]> {
    const names: RenameInput['names'] = [];
    for (const file of files) {
      signal.throwIfAborted();
      const metadata =
        request.options?.metadata && !file.directory
          ? (await this.dependencies.extract(file.path, signal)).metadata
          : undefined;
      names.push({
        name: file.name,
        extension: file.directory ? '' : path.extname(file.name),
        metadata,
      });
    }
    const input = { names, options: request.options || {}, template: recipe.template };
    if (input.options.regex && !this.dependencies.rename)
      throw new Error('Regex rename previews require an isolated worker.');
    const renamed = this.dependencies.rename
      ? await this.dependencies.rename(input, signal)
      : renameNames(input);
    return files.map((file, index) => {
      const name = renamed[index];
      if (name === undefined) throw new Error('The rename preview is incomplete.');
      return this.row(file, path.join(file.parent, name));
    });
  }
  /** Names from document contents: by a model, or locally for a book recipe without one. */
  private async planDocuments(planning: Planning, files: FileEntry[]): Promise<void> {
    const { plan, recipe, request, signal } = planning;
    const provider = this.dependencies
      .providers()
      .find((provider) => provider.id === recipe.providerID);
    if (recipe.kind !== 'book-name' && !provider)
      throw new Error('Choose a model provider for this recipe in Settings.');
    const documents = await this.readDocuments(planning, files);
    if (!provider) {
      plan.rows = files.map((file) => {
        const review = localPublication(file, documents.get(file.path)!, recipe.template);
        return this.row(file, review.destination, review.evidence, review.issue);
      });
      return;
    }
    const input = modelInput(files, documents, recipe.data);
    const response = modelResponse.parse(
      await this.dependencies.generate(
        provider,
        modelInstructions(recipe, request),
        input,
        z.toJSONSchema(modelResponse) as Record<string, unknown>,
        signal,
        recipe.data,
        plan.context.actor,
      ),
    );
    for (const review of reviewModelRows(response.rows, files, documents, recipe))
      if (review.kind === 'summary') plan.summary = (plan.summary || '') + review.section;
      else plan.rows.push(this.row(review.file, review.destination, review.evidence, review.issue));
  }
  /** A document that cannot be read is planned as empty, unless planning was cancelled. */
  private async readDocuments(
    { recipe, signal }: Planning,
    files: FileEntry[],
  ): Promise<Map<string, DocumentData>> {
    const documents = new Map<string, DocumentData>();
    for (const file of files) {
      signal.throwIfAborted();
      if (!recipeReadsContent(recipe)) continue;
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
    return documents;
  }
  /** Records each row's canonical scope, checks the rows together and publishes for review. */
  private async offerForReview(plan: ActionPlan): Promise<void> {
    for (const row of plan.rows) if (row.source) row.scopeRoot = await realpath(row.source.parent);
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
        row.issue = errorMessage(error);
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
  private async scope(
    destination: string,
    source?: FileEntry,
    roots?: string[],
    canonical = false,
  ): Promise<void> {
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
      : canonical
        ? (roots ?? [])
        : await Promise.all((roots || []).map((root) => realpath(root)));
    if (!allowed.some((root) => containsPath(root, actual)))
      throw new Error('The destination escapes the selected file scope through a symbolic link.');
  }
  private async scopeRow(plan: ActionPlan, row: ProposedChange): Promise<void> {
    if (row.restoration) {
      if (row.destination !== row.restoration.destination)
        throw new Error('A restoration can only return the file to its recorded original path.');
      return this.scope(row.destination, undefined, [row.restoration.root], true);
    }
    return this.scope(
      row.destination,
      row.source,
      plan.outputRoot
        ? [plan.outputRoot]
        : plan.context.sources.map((source) => path.dirname(source)),
    );
  }
  private async restoreRow(
    original: ProposedChange,
    current: string,
    evidence: DocumentEvidence[] = [],
  ): Promise<ProposedChange> {
    if (!original.source) throw new Error('This row has no original file to restore.');
    const source = await entry(current);
    if (!same(original.source, source))
      throw new Error('A recorded file changed. Restoration is unavailable.');
    let root = original.scopeRoot;
    if (!root) {
      // Older plans have no canonical scope. Derive it from the verified surviving file,
      // then require its recorded parent to still resolve to that same ancestor.
      const relative = path.relative(original.source.parent, current);
      if (
        !relative ||
        relative === '..' ||
        relative.startsWith('..' + path.sep) ||
        path.isAbsolute(relative)
      )
        throw new Error(
          'The recorded restoration scope is unavailable. Inspect the original paths.',
        );
      root = await realpath(current);
      for (const _part of relative.split(path.sep)) root = path.dirname(root);
      if ((await realpath(original.source.parent)) !== root)
        throw new Error(
          'The original folder changed through a symbolic link. Inspect its path before restoring.',
        );
    }
    return {
      ...this.row(source, original.source.path, evidence),
      scopeRoot: root,
      restoration: { destination: original.source.path, root },
    };
  }
  async apply(approval: ActionApproval): Promise<void> {
    await this.load();
    if (this.closed) throw new Error('Actions have closed.');
    const plan = this.plans.get(approval.id);
    if (!plan || plan.revision !== approval.revision || plan.status !== 'review')
      throw new Error('This proposal changed. Review its current version.');
    const { rows, selected } = mergeApproval(plan.rows, approval);
    await this.preflight(plan, rows, selected);
    plan.rows = rows;
    plan.status = 'applying';
    const abort = new AbortController();
    this.aborts.set(plan.id, abort);
    await this.publish(plan);
    const work = this.dependencies.operations
      .exclusive((publish) =>
        this.applySelection({ plan, selected, publish, signal: abort.signal }, approval.checkpoint),
      )
      .finally(() => {
        this.aborts.delete(plan.id);
        this.work.delete(plan.id);
      });
    this.work.set(plan.id, work);
    await work;
  }
  /** Checks the selection before anything moves; selected conflicts are published for review. */
  private async preflight(
    plan: ActionPlan,
    rows: ProposedChange[],
    selected: ProposedChange[],
  ): Promise<void> {
    await this.dependencies.access?.([
      ...plan.context.sources,
      ...selected.flatMap((row) => [row.destination, ...(row.source ? [row.source.path] : [])]),
    ]);
    if (selected.some((row) => row.kind === 'summary')) await this.validateSummary(plan);
    await this.checkRows(selected);
    if (selected.some((row) => row.issue)) {
      plan.rows = rows;
      await this.publish(plan);
      throw new Error('Resolve the selected conflicts before applying.');
    }
    for (const row of selected) {
      if (row.source && !same(row.source, await entry(row.source.path)))
        throw new Error('A source changed after planning. Run the action again.');
      await this.scopeRow(plan, row);
    }
  }
  private async applySelection(applying: Applying, checkpoint?: boolean): Promise<void> {
    const { plan, selected, signal } = applying;
    const changes: FileChange[] = [];
    try {
      if (checkpoint) await this.takeCheckpoint(applying);
      await this.revalidate(applying);
      await this.stageSelection(applying);
      for (const row of selected) {
        signal.throwIfAborted();
        await this.publishRow(applying, row);
        if (row.source) changes.push({ source: row.source.path, destination: row.destination });
        row.completed = true;
        row.stagedPath = undefined;
        await this.recordStep(plan, row);
      }
      plan.status = 'completed';
      plan.undoable = selected.every((row) => !!row.source);
    } catch (error) {
      plan.error = errorMessage(error);
      await this.restoreStaged(applying);
      plan.status = stoppedStatus(selected, signal.aborted);
      plan.undoable = false;
    } finally {
      if (changes.length) this.dependencies.changed(changes);
      await this.publish(plan);
      // Recorded as settled, the plan no longer needs its step log (see sweepSteps).
      await removePrivateData(this.dataPath, this.stepFile(plan.id)).catch(() => {});
    }
  }
  private async takeCheckpoint({ plan, selected, signal }: Applying): Promise<void> {
    if (!this.dependencies.snapshot) throw new Error('Checkpoints are unavailable in this build.');
    plan.checkpointID = await this.dependencies.snapshot(
      plan.title,
      selected.flatMap((row) => (row.source ? [row.source.path] : [])),
      signal,
    );
    await this.publish(plan);
  }
  private async revalidate({ plan, selected, signal }: Applying): Promise<void> {
    if (selected.some((row) => row.kind === 'summary')) await this.validateSummary(plan);
    for (const row of selected) {
      signal.throwIfAborted();
      if (row.source && !same(row.source, await entry(row.source.path)))
        throw new Error('A source changed before its operation.');
    }
  }
  /** Moves every selected source aside before any is published, allowing cycles and case-only
   * renames. Each staging path is in the step log before and after its move. */
  private async stageSelection({ plan, selected, publish, signal }: Applying): Promise<void> {
    for (const row of selected) {
      signal.throwIfAborted();
      const source = row.source;
      if (!source) continue;
      if (!same(source, await entry(source.path)))
        throw new Error('A source changed immediately before its operation.');
      row.stagedPath = path.join(source.parent, '.viewer-action-' + randomUUID());
      await this.recordStep(plan, row);
      await publish(
        source.path,
        row.stagedPath,
        async () => {
          signal.throwIfAborted();
          if (!same(source, await entry(source.path)))
            throw new Error('A source changed while waiting for its file provider.');
        },
        signal,
      );
      await this.recordStep(plan, row);
    }
  }
  /** Moves a staged source to its destination, or writes a row that has no source. */
  private async publishRow(applying: Applying, row: ProposedChange): Promise<void> {
    const { plan, publish, signal } = applying;
    await this.scopeRow(plan, row);
    await this.ensureParent(applying, row);
    const source = row.source;
    if (!source) return this.writeOutput(applying, row);
    const staged = row.stagedPath!;
    if (!same(source, await entry(staged)))
      throw new Error('A staged source changed; it was preserved for recovery.');
    await publish(
      staged,
      row.destination,
      async () => {
        signal.throwIfAborted();
        if (!same(source, await entry(staged)))
          throw new Error('A staged source changed while waiting for its file provider.');
      },
      signal,
    );
  }
  private async ensureParent({ plan, signal }: Applying, row: ProposedChange): Promise<void> {
    const parent = path.dirname(row.destination);
    if (await exists(parent)) return;
    await fileCoordination.run(
      [{ path: parent, mode: 'write' }],
      async (coordinated) => {
        coordinated?.throwIfAborted();
        await this.scopeRow(plan, row);
        await mkdir(fileCoordination.path(parent), { recursive: true });
      },
      signal,
    );
  }
  /** A summary is written as a new private file; a folder row creates its folder. */
  private async writeOutput({ plan, signal }: Applying, row: ProposedChange): Promise<void> {
    await fileCoordination.run(
      [{ path: row.destination, mode: 'write' }],
      async (coordinated) => {
        coordinated?.throwIfAborted();
        await this.scopeRow(plan, row);
        if (row.kind === 'summary') {
          await this.validateSummary(plan);
          const handle = await open(fileCoordination.path(row.destination), 'wx', 0o600);
          try {
            await handle.writeFile(row.text || '');
            await handle.sync();
          } finally {
            await handle.close();
          }
        } else if (row.kind === 'mkdir') await mkdir(fileCoordination.path(row.destination));
        coordinated?.throwIfAborted();
      },
      signal,
    );
  }
  /** Returns staged originals only to free original paths; never overwrites a concurrent file. */
  private async restoreStaged({ selected, publish }: Applying): Promise<void> {
    for (const row of selected)
      if (row.stagedPath && (await exists(row.stagedPath)) && row.source) {
        try {
          if (!(await exists(row.source.path)) && same(row.source, await entry(row.stagedPath))) {
            await publish(row.stagedPath, row.source.path);
            row.stagedPath = undefined;
          }
        } catch {
          /* The durable journal retains the surviving staging path. */
        }
      }
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
          .map((row) => this.restoreRow(row, row.destination)),
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
            await this.restoreRow(row, current, [{ source: 'Recovery journal', text: current }]),
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
