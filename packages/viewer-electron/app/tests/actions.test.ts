import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DocumentStore } from '../src/desktop/persistence/document-store';
import {
  appendFile,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rename,
  symlink,
  realpath,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import { ActionPlanner } from '../src/desktop/actions/planner';
import { Operations } from '../src/desktop/operations/operations';
import { AgentBroker } from '../src/desktop/agents/agent-broker';
import { defaultSettings } from '../src/domain/services';
import { epubFixture } from './fixtures';
import { extractDocument } from '../src/desktop/previews/formats';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import { removalBlocked } from './support/preservation';
import type { FileServices } from '../src/desktop/files/file-services';
import type {
  ActionPlan,
  ActionRecipe,
  ActionRequest,
  ApplicationSettings,
  DocumentData,
  ModelProvider,
} from '../src/domain/services';
let root: string,
  files: string,
  planner: ActionPlanner,
  operations: Operations,
  settings: ApplicationSettings;
type Dependencies = ConstructorParameters<typeof ActionPlanner>[1];
type Generate = Dependencies['generate'];
const context = () => ({
  workspaceID: 'workspace',
  rootID: 'root-one',
  paneID: 'folder-one',
  actor: 'user' as const,
  sources: [path.join(files, 'A.txt'), path.join(files, 'B.txt')],
});
const approve = (plan: ActionPlan) => ({
  id: plan.id,
  revision: plan.revision,
  rows: plan.rows.map((row) => ({
    id: row.id,
    destination: row.destination,
    approved: row.approved,
  })),
});
const create = (overrides: Partial<Dependencies> = {}) =>
  new ActionPlanner(root, {
    recipes: () => settings.recipes,
    providers: () => settings.providers,
    extract: (file, signal) => extractDocument(file, { signal }),
    generate: async () => {
      throw new Error('No provider calls in these tests');
    },
    operations,
    emit: () => {},
    changed: () => {},
    ...overrides,
  });
beforeEach(async () => {
  root = await temporaryRoot('viewer-actions-');
  files = path.join(root, 'files');
  await mkdir(files);
  await writeFile(path.join(files, 'A.txt'), 'original A');
  await writeFile(path.join(files, 'B.txt'), 'original B');
  settings = defaultSettings(root);
  operations = new Operations(
    async () => {
      throw new Error('Trash is prohibited in action tests');
    },
    () => {},
  );
  planner = create();
});
afterEach(async () => {
  await planner.close();
  await operations.close();
  await trashTemporary(root);
});
async function batch(prefix = 'New ') {
  const id = await planner.start({
    recipeID: 'batch-rename',
    context: context(),
    options: { prefix },
  });
  await planner.settled(id);
  return planner.get(id);
}
async function reopen(overrides: Partial<Dependencies> = {}): Promise<void> {
  await planner.close();
  planner = create(overrides);
}
async function propose(recipeID: string, request: Partial<ActionRequest> = {}) {
  const id = await planner.start({ recipeID, context: context(), ...request });
  await planner.settled(id);
  return planner.get(id);
}
const fixtureProvider: ModelProvider = {
  id: 'fixture',
  name: 'Fixture',
  kind: 'local',
  endpoint: 'http://localhost:1234/v1',
  model: 'fixture',
  allowContent: false,
};
/** Binds a recipe to the fixture provider and reopens the planner with the given dependencies. */
async function modelPlanner(
  recipeID: string,
  recipe: Partial<ActionRecipe>,
  overrides: Partial<Dependencies>,
): Promise<void> {
  settings.providers = [fixtureProvider];
  settings.recipes = settings.recipes.map((item) =>
    item.id === recipeID ? { ...item, providerID: 'fixture', ...recipe } : item,
  );
  await reopen(overrides);
}
async function organizePlanner(generate: Generate): Promise<void> {
  await modelPlanner(
    'organize',
    { data: 'names' },
    {
      extract: async () => {
        throw new Error('Names-only fixture');
      },
      generate,
    },
  );
}
type ModelRow = {
  sourceID: string;
  destination: string;
  summary: string;
  fields: Record<'year' | 'authors' | 'title' | 'publisher', string | null>;
  evidence: { field: string; source: string; text: string }[];
};
const modelRow = (sourceID: string, destination: string, patch: Partial<ModelRow> = {}) => ({
  sourceID,
  destination,
  summary: '',
  fields: { year: null, authors: null, title: null, publisher: null },
  evidence: [],
  ...patch,
});
const organizeOutput = (input: unknown) => ({
  rows: (input as { sourceID: string; filename: string }[]).map((file) =>
    modelRow(file.sourceID, 'Organized/' + file.filename),
  ),
});
const respond =
  (...rows: unknown[]): Generate =>
  async () => ({ rows });
const document = (file: string, patch: Partial<DocumentData> = {}): DocumentData => ({
  path: file,
  text: '',
  metadata: {},
  evidence: [],
  truncated: false,
  ...patch,
});
/** Runs `before` and `after` around each publication inside the planner's exclusive work. */
function intercept(hooks: {
  before?: (source: string, destination: string) => Promise<void>;
  after?: (source: string, destination: string) => Promise<void>;
}): void {
  const original = operations.exclusive.bind(operations);
  operations.exclusive = (work) =>
    original((publish) =>
      work(async (source, destination, guard, signal) => {
        await hooks.before?.(source, destination);
        await publish(source, destination, guard, signal);
        await hooks.after?.(source, destination);
      }),
    );
}
const staging = (file: string) => path.basename(file).startsWith('.viewer-action-');
const stagedFiles = async () => (await readdir(files)).filter(staging);
const at = (name: string) => path.join(files, name);
/** Asserts the exact reason a person reads. */
async function refuses(work: Promise<unknown>, message: string): Promise<void> {
  await expect(work).rejects.toHaveProperty('message', message);
}
describe('reviewed file action transactions', () => {
  it('cancels a queued agent recipe on global withdrawal without cancelling a user recipe', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const generate = vi.fn<Generate>(async (_provider, _instructions, input) => {
      await gate;
      return organizeOutput(input);
    });
    await organizePlanner(generate);
    const user = await planner.start({ recipeID: 'organize', context: context() });
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    settings.agents = { enabled: true, roots: [files], allowLayout: false };
    const broker = new AgentBroker(
      path.join(root, 'AgentProfile'),
      () => settings,
      context,
      {} as FileServices,
      planner,
    );
    const change = { enabled: true, add: [files], capabilities: ['metadata', 'propose'] as const };
    await broker.access.approve(change, await broker.access.captureReview(change));
    const token = await broker.credential();
    try {
      const response = (await broker.handle(token, {
        method: 'tools/call',
        params: {
          name: 'run_action',
          arguments: { recipeID: 'organize', sources: context().sources },
        },
      })) as { content: { text: string }[] };
      const { id } = JSON.parse(response.content[0]!.text) as { id: string };
      await broker.access.approve({ enabled: false });
      finish();
      await planner.settled(user);
      await planner.settled(id);
      expect(generate).toHaveBeenCalledOnce();
      expect((await planner.get(user)).status).toBe('review');
      expect((await planner.get(id)).status).toBe('cancelled');
    } finally {
      finish();
      await broker.close();
    }
  });
  it('refuses restoration when the original parent is replaced by a symbolic link', async () => {
    await organizePlanner(async (_provider, _instructions, input) => organizeOutput(input));
    const id = await planner.start({ recipeID: 'organize', context: context() });
    await planner.settled(id);
    await planner.apply(approve(await planner.get(id)));
    const relocated = path.join(root, 'relocated-files');
    await rename(files, relocated);
    await symlink(relocated, files);
    await expect(planner.undo(id)).rejects.toThrow('symbolic link');
    expect(await readFile(path.join(relocated, 'Organized', 'A.txt'), 'utf8')).toBe('original A');
  });
  it('restores organized files to their original parent after a restart, without widening restoration scope', async () => {
    await organizePlanner(async (_provider, _instructions, input) => organizeOutput(input));
    const id = await planner.start({ recipeID: 'organize', context: context() });
    await planner.settled(id);
    await planner.apply(approve(await planner.get(id)));
    expect((await planner.get(id)).status).toBe('completed');
    await planner.close();
    planner = create();
    await planner.get(id);
    await planner.undo(id);
    expect(await readFile(path.join(files, 'A.txt'), 'utf8')).toBe('original A');
    expect(await readFile(path.join(files, 'B.txt'), 'utf8')).toBe('original B');
    expect((await planner.get(id)).undoable).toBe(false);
  });
  it('retains summary source checks across restart and revalidates immediately before Apply', async () => {
    settings.providers = [
      {
        id: 'fixture',
        name: 'Fixture',
        kind: 'local',
        endpoint: 'http://localhost:1234/v1',
        model: 'fixture',
        allowContent: false,
      },
    ];
    settings.recipes = settings.recipes.map((recipe) =>
      recipe.id === 'summarize' ? { ...recipe, providerID: 'fixture', data: 'names' } : recipe,
    );
    await planner.close();
    planner = new ActionPlanner(root, {
      recipes: () => settings.recipes,
      providers: () => settings.providers,
      extract: async () => {
        throw new Error('Names-only summaries must not read content');
      },
      generate: async (_provider, _instructions, input) => ({
        rows: (input as { sourceID: string; filename: string }[]).map((file) => ({
          sourceID: file.sourceID,
          destination: '',
          summary: 'Summary of ' + file.filename,
          fields: { year: null, authors: null, title: null, publisher: null },
          evidence: [],
        })),
      }),
      operations,
      emit: () => {},
      changed: () => {},
    });
    const id = await planner.start({ recipeID: 'summarize', context: context() });
    await planner.settled(id);
    expect((await planner.get(id)).summaryInputs).toHaveLength(2);
    await planner.close();
    planner = create();
    const destination = path.join(files, 'Summary.md');
    await planner.exportSummary(id, destination);
    const review = await planner.get(id);
    await writeFile(path.join(files, 'A.txt'), 'modified after review');
    await expect(planner.apply(approve(review))).rejects.toThrow('summary source changed');
    await expect(readFile(destination)).rejects.toThrow();
    await expect(planner.exportSummary(id, destination)).rejects.toThrow('summary source changed');
  });
  it('proposes the publication naming template from EPUB evidence without a provider or writes', async () => {
    const book = path.join(files, 'Book.epub');
    await writeFile(book, epubFixture());
    const id = await planner.start({
      recipeID: 'book-name',
      context: { ...context(), sources: [book] },
    });
    await planner.settled(id);
    const plan = await planner.get(id);
    expect(plan.status).toBe('review');
    expect(plan.rows[0].issue).toBeUndefined();
    expect(path.basename(plan.rows[0].destination)).toBe(
      '2000, J. E. Rehder, Fire in antiquity, Fixture Press.epub',
    );
    expect(plan.rows[0].evidence.some((item) => item.source === 'publication:publisher')).toBe(
      true,
    );
    expect(await readFile(book)).toEqual(epubFixture());
    await planner.apply(approve(plan));
    expect(await readFile(plan.rows[0].destination)).toEqual(epubFixture());
    await planner.undo(id);
    expect(await readFile(book)).toEqual(epubFixture());
  });
  it('plans without writes, applies only approved rows, and guards Undo', async () => {
    const before = await readdir(files);
    const plan = await batch();
    expect(await readdir(files)).toEqual(before);
    expect(plan.context.rootID).toBe('root-one');
    expect(plan.status).toBe('review');
    const approval = approve(plan);
    approval.rows[1].approved = false;
    await planner.apply(approval);
    expect(await readFile(path.join(files, 'New A.txt'), 'utf8')).toBe('original A');
    expect(await readFile(path.join(files, 'B.txt'), 'utf8')).toBe('original B');
    expect((await planner.get(plan.id)).undoable).toBe(true);
    await planner.undo(plan.id);
    expect(await readFile(path.join(files, 'A.txt'), 'utf8')).toBe('original A');
    expect(await readdir(files)).toEqual(before);
  });
  it('supports cycles by staging the entire approved selection', async () => {
    const plan = await batch();
    const approval = approve(plan);
    approval.rows[0].destination = path.join(files, 'B.txt');
    approval.rows[1].destination = path.join(files, 'A.txt');
    await planner.apply(approval);
    expect((await planner.get(plan.id)).status).toBe('completed');
    expect(await readFile(path.join(files, 'A.txt'), 'utf8')).toBe('original B');
    expect(await readFile(path.join(files, 'B.txt'), 'utf8')).toBe('original A');
    await planner.undo(plan.id);
    expect(await readFile(path.join(files, 'A.txt'), 'utf8')).toBe('original A');
  });
  it('never overwrites a destination that appeared after planning', async () => {
    const plan = await batch();
    await writeFile(plan.rows[0].destination, 'concurrent file', { flag: 'wx' });
    await expect(planner.apply(approve(plan))).rejects.toThrow('conflicts');
    expect(await readFile(plan.rows[0].destination, 'utf8')).toBe('concurrent file');
    expect(await readFile(path.join(files, 'A.txt'), 'utf8')).toBe('original A');
  });
  it('rejects changed sources, stale revisions and changed completed files', async () => {
    const plan = await batch();
    await expect(planner.apply({ ...approve(plan), revision: 0 })).rejects.toThrow('changed');
    await writeFile(path.join(files, 'A.txt'), 'modified source');
    await expect(planner.apply(approve(plan))).rejects.toThrow('source changed');
    const next = await batch();
    await planner.apply(approve(next));
    await writeFile(next.rows[0].destination, 'modified completed');
    await expect(planner.undo(next.id)).rejects.toThrow('changed');
    expect(await readFile(next.rows[0].destination, 'utf8')).toBe('modified completed');
  });
  it('rejects traversal and symbolic-link destination escapes', async () => {
    const elsewhere = path.join(root, 'elsewhere');
    await mkdir(elsewhere);
    await symlink(elsewhere, path.join(files, 'escape'));
    const plan = await batch();
    const approval = approve(plan);
    approval.rows[0].destination = path.join(files, 'escape', 'A.txt');
    await expect(planner.apply(approval)).rejects.toThrow('escapes');
    expect(await readdir(elsewhere)).toEqual([]);
    approval.rows[0].destination = path.join(elsewhere, 'A.txt');
    await expect(planner.apply(approval)).rejects.toThrow('escapes');
  });
  it('restores staged originals after a failed publication without overwriting a concurrent writer', async () => {
    const plan = await batch();
    const original = operations.exclusive.bind(operations);
    operations.exclusive = (work) =>
      original((publish) =>
        work(async (source, destination) => {
          if (destination.endsWith('New A.txt')) {
            await writeFile(destination, 'race', { flag: 'wx' });
          }
          await publish(source, destination);
        }),
      );
    await planner.apply(approve(plan));
    expect((await planner.get(plan.id)).status).toBe('failed');
    expect(await readFile(path.join(files, 'A.txt'), 'utf8')).toBe('original A');
    expect(await readFile(path.join(files, 'B.txt'), 'utf8')).toBe('original B');
    expect(await readFile(path.join(files, 'New A.txt'), 'utf8')).toBe('race');
    expect((await readdir(files)).some((file) => file.startsWith('.viewer-action'))).toBe(false);
  });
  it('keeps Actions working when a step log cannot be read (2026-10-20)', async () => {
    // A corrupt middle line, or a log over its limit, rejected load(), which every Actions call
    // awaits, and the rejection was kept: Actions stayed unavailable, after a restart too.
    const plan = await batch();
    plan.status = 'applying';
    await writeFile(path.join(root, 'action-journal-v1.json'), JSON.stringify([plan]));
    await writeFile(path.join(root, `action-steps-${plan.id}.jsonl`), 'not json\n{"row":"x"}\n');
    await planner.close();
    planner = create();
    const recovered = await planner.get(plan.id);
    expect(recovered.status).toBe('recovery');
    expect(recovered.error).toContain('.unreadable-');
    expect(
      (await readdir(root)).some((name) =>
        name.startsWith(`action-steps-${plan.id}.jsonl.unreadable-`),
      ),
    ).toBe(true);
    expect((await batch()).status).toBe('review');
  });
  it('reads the task journal again after a failed read (2026-10-20)', async () => {
    await planner.close();
    vi.spyOn(DocumentStore.prototype, 'load').mockRejectedValueOnce(new Error('transient'));
    planner = create();
    await expect(planner.all()).rejects.toThrow('transient');
    await expect(planner.all()).resolves.toEqual([]);
    vi.restoreAllMocks();
  });
  it('removes a step log once its plan is recorded as settled (2026-10-20)', async () => {
    // Step logs were never removed: private files keeping every source and destination path.
    const plan = await batch();
    await planner.apply(approve(plan));
    expect((await planner.get(plan.id)).status).toBe('completed');
    const stepFile = `action-steps-${plan.id}.jsonl`;
    const retained = removalBlocked('settled action step-log cleanup', [path.join(root, stepFile)]);
    expect((await readdir(root)).includes(stepFile)).toBe(retained);
  });
  it('removes at load the step logs no interrupted plan needs (2026-10-20)', async () => {
    const orphan = `action-steps-${randomUUID()}.jsonl`;
    await writeFile(path.join(root, orphan), '{"row":"x","completed":true}\n');
    const plan = await batch();
    plan.status = 'applying';
    await writeFile(path.join(root, 'action-journal-v1.json'), JSON.stringify([plan]));
    const needed = `action-steps-${plan.id}.jsonl`;
    await writeFile(path.join(root, needed), '');
    await planner.close();
    planner = create();
    await planner.load();
    const names = await readdir(root);
    const retained = removalBlocked('orphan action step-log cleanup', [path.join(root, orphan)]);
    expect(names.includes(orphan)).toBe(retained);
    expect(names).toContain(needed);
  });
  it('recovers a crash between publishing a destination and its completion checkpoint', async () => {
    const plan = await batch();
    const source = plan.rows[0].source!;
    plan.status = 'applying';
    plan.rows[0].stagedPath = path.join(files, '.viewer-action-fixture');
    await writeFile(path.join(root, 'action-journal-v1.json'), JSON.stringify([plan]));
    await rename(source.path, plan.rows[0].destination);
    await planner.close();
    planner = create();
    await planner.load();
    expect((await planner.get(plan.id)).status).toBe('recovery');
    await planner.recovery(plan.id);
    const recovery = (await planner.all()).find((item) => item.title.startsWith('Restore'))!;
    expect(recovery.rows[0].destination).toBe(source.path);
    await planner.apply(approve(recovery));
    expect(await readFile(source.path, 'utf8')).toBe('original A');
  });
  it('bounds recursive proposals and keeps unsupported/symlink inputs out of book actions', async () => {
    const id = await planner.start({
      recipeID: 'book-name',
      context: { ...context(), sources: [files], recursive: true },
    });
    await planner.settled(id);
    expect((await planner.get(id)).status).toBe('failed');
    expect(await readFile(path.join(files, 'A.txt'), 'utf8')).toBe('original A');
  });
  it('cancels planning without file changes', async () => {
    const id = await planner.start({ recipeID: 'batch-rename', context: context() });
    planner.cancel(id);
    await planner.settled(id);
    expect((await planner.get(id)).status).toBe('cancelled');
    expect((await readdir(files)).sort()).toEqual(['A.txt', 'B.txt']);
  });
});
describe('action admission and local planning', () => {
  it('refuses a request it cannot admit', async () => {
    await refuses(
      planner.start({ recipeID: 'missing', context: context() }),
      'This action recipe is unavailable.',
    );
    await refuses(
      planner.start({ recipeID: 'batch-rename', context: { ...context(), sources: [] } }),
      'Select files or a folder first.',
    );
    const recipe = settings.recipes.find((item) => item.id === 'batch-rename')!;
    await refuses(
      planner.start(
        { recipeID: 'batch-rename', context: context() },
        { ...recipe, template: '{name}' },
      ),
      'The recipe changed after approval. Review the workflow rule again.',
    );
    await planner.close();
    await refuses(
      planner.start({ recipeID: 'batch-rename', context: context() }),
      'Actions have closed.',
    );
  });
  it('refuses a new task while 100 unsettled tasks are recorded', async () => {
    const plan = await batch();
    await planner.close();
    await writeFile(
      path.join(root, 'action-journal-v1.json'),
      JSON.stringify(Array.from({ length: 100 }, () => ({ ...plan, id: randomUUID() }))),
    );
    planner = create();
    await refuses(
      planner.start({ recipeID: 'batch-rename', context: context() }),
      'Review or finish existing tasks before starting another.',
    );
  });
  it('fails planning past 2,000 files', async () => {
    const many = at('many');
    await mkdir(many);
    for (let index = 0; index <= 2000; index++)
      await writeFile(path.join(many, index + '.txt'), '');
    expect(
      await propose('batch-rename', { context: { ...context(), sources: [many] } }),
    ).toMatchObject({ status: 'failed', error: 'Choose at most 2,000 files per action.' });
  });
  it('fails planning without a supported file or a provider for a model recipe', async () => {
    expect(await propose('book-name')).toMatchObject({
      status: 'failed',
      error: 'No supported files were found in the selection.',
    });
    expect(await propose('organize')).toMatchObject({
      status: 'failed',
      error: 'Choose a model provider for this recipe in Settings.',
    });
  });
  it('needs the isolated worker for a regular-expression rename', async () => {
    expect(
      await propose('batch-rename', { options: { regex: true, find: 'A', replace: 'C' } }),
    ).toMatchObject({
      status: 'failed',
      error: 'Regex rename previews require an isolated worker.',
    });
  });
  it('sends names, extensions and extracted metadata to the rename worker', async () => {
    const rename = vi.fn<NonNullable<Dependencies['rename']>>(async (input) =>
      input.names.map((item) => 'Renamed ' + item.name),
    );
    await reopen({
      rename,
      extract: async (file) => document(file, { metadata: { title: path.basename(file, '.txt') } }),
    });
    const plan = await propose('batch-rename', { options: { metadata: true, prefix: 'X ' } });
    expect(rename).toHaveBeenCalledExactlyOnceWith(
      {
        names: [
          { name: 'A.txt', extension: '.txt', metadata: { title: 'A' } },
          { name: 'B.txt', extension: '.txt', metadata: { title: 'B' } },
        ],
        options: { metadata: true, prefix: 'X ' },
        template: '{name}{extension}',
      },
      expect.any(AbortSignal),
    );
    expect(plan.rows.map((row) => [row.kind, row.destination, row.approved])).toEqual([
      ['rename', at('Renamed A.txt'), true],
      ['rename', at('Renamed B.txt'), true],
    ]);
  });
  it('fails a rename preview that is incomplete or whose metadata cannot be read', async () => {
    await reopen({ rename: async () => ['New A.txt'] });
    expect(await propose('batch-rename')).toMatchObject({
      status: 'failed',
      error: 'The rename preview is incomplete.',
      rows: [],
    });
    await reopen({
      extract: async () => {
        throw new Error('Unreadable metadata.');
      },
    });
    expect(await propose('batch-rename', { options: { metadata: true } })).toMatchObject({
      status: 'failed',
      error: 'Unreadable metadata.',
    });
  });
  it('marks an unchanged filename', async () => {
    expect((await batch('')).rows.map((row) => [row.issue, row.approved])).toEqual([
      ['The filename is unchanged.', false],
      ['The filename is unchanged.', false],
    ]);
  });
  it('names a book locally from its metadata and marks the unresolved fields', async () => {
    const book = at('Book.epub');
    await writeFile(book, 'fixture');
    const evidence = [
      { source: 'chapter:1', text: 'Chapter text' },
      ...Array.from({ length: 24 }, (_, index) => ({
        source: 'publication:' + index,
        text: 'Quote ' + index,
      })),
    ];
    await reopen({
      extract: async (file) =>
        document(file, { metadata: { date: '1999-05-01', title: 'Partial' }, evidence }),
    });
    const plan = await propose('book-name', { context: { ...context(), sources: [book] } });
    expect(plan.status).toBe('review');
    expect(plan.rows).toMatchObject([
      {
        kind: 'rename',
        destination: at('1999, [authors], Partial, [publisher].epub'),
        issue: 'Missing authors, publisher. Edit the name or configure a model.',
        approved: false,
        evidence: evidence.slice(1, 21),
      },
    ]);
  });
  it('names a book it cannot read with every field unresolved', async () => {
    const book = at('Book.epub');
    await writeFile(book, 'fixture');
    await reopen({
      extract: async () => {
        throw new Error('Unreadable book.');
      },
    });
    const plan = await propose('book-name', { context: { ...context(), sources: [book] } });
    expect(plan.status).toBe('review');
    expect(plan.rows).toMatchObject([
      {
        destination: at('[year], [authors], [title], [publisher].epub'),
        issue: 'Missing year, authors, title, publisher. Edit the name or configure a model.',
        approved: false,
        evidence: [],
      },
    ]);
  });
});
describe('model proposals', () => {
  const instructions = (request: string) =>
    'Suggest descriptive names while preserving extensions.\n' +
    request +
    '\nFor books return year, authors, title and publisher with a quote for each. For organize return a relative destination inside the existing parent directory. For rename return a filename. For summarize return a summary. Return exactly one row per sourceID.';
  it('sends the instructions, names-level input and actor, and reviews one row per file', async () => {
    const generate = vi.fn<Generate>(
      respond(modelRow('0', 'Alpha.txt'), modelRow('1', 'Beta.txt')),
    );
    await modelPlanner('rename', { data: 'names' }, { generate });
    const plan = await propose('rename', { instructions: 'Prefer Greek letters.' });
    expect(generate).toHaveBeenCalledExactlyOnceWith(
      fixtureProvider,
      instructions('Prefer Greek letters.'),
      [
        { sourceID: '0', filename: 'A.txt', extension: '.txt', metadata: {}, evidence: [] },
        { sourceID: '1', filename: 'B.txt', extension: '.txt', metadata: {}, evidence: [] },
      ],
      expect.objectContaining({ type: 'object' }),
      expect.any(AbortSignal),
      'names',
      'user',
    );
    expect(plan.status).toBe('review');
    expect(plan.rows).toMatchObject([
      { kind: 'rename', destination: at('Alpha.txt'), approved: true },
      { kind: 'rename', destination: at('Beta.txt'), approved: true },
    ]);
    expect(plan.rows.map((row) => [row.issue, row.scopeRoot])).toEqual([
      [undefined, await realpath(files)],
      [undefined, await realpath(files)],
    ]);
    await modelPlanner('rename', { data: 'names' }, { generate });
    await propose('rename');
    expect(generate.mock.lastCall?.[1]).toBe(instructions(''));
  });
  it('bounds the evidence it sends by data level', async () => {
    const evidence = [
      { source: 'text', text: 'x'.repeat(25000) },
      ...Array.from({ length: 69 }, (_, index) => ({
        source: 'page:' + index,
        text: 'Page ' + index,
      })),
    ];
    const generate = vi.fn<Generate>(
      respond(modelRow('0', 'Alpha.txt'), modelRow('1', 'Beta.txt')),
    );
    const levels = [
      ['excerpts', 16, 6000],
      ['full-text', 64, 20000],
    ] as const;
    for (const [data, count, length] of levels) {
      await modelPlanner(
        'rename',
        { data },
        {
          generate,
          extract: async (file) => document(file, { metadata: { title: 'T' }, evidence }),
        },
      );
      expect((await propose('rename')).status).toBe('review');
      const [input] = generate.mock.lastCall![2] as Pick<DocumentData, 'metadata' | 'evidence'>[];
      expect(input!.metadata).toEqual({ title: 'T' });
      expect(input!.evidence).toHaveLength(count);
      expect(input!.evidence[0]!.text).toHaveLength(length);
      expect(input!.evidence[1]).toEqual({ source: 'page:0', text: 'Page 0' });
    }
  });
  it('refuses input over 500,000 characters before calling the model', async () => {
    const generate = vi.fn<Generate>(respond(modelRow('0', 'Alpha.txt')));
    const sized = async (title: string) => {
      await modelPlanner(
        'rename',
        { data: 'excerpts' },
        { generate, extract: async (file) => document(file, { metadata: { title } }) },
      );
      return propose('rename', { context: { ...context(), sources: [at('A.txt')] } });
    };
    await sized('');
    const base = JSON.stringify(generate.mock.lastCall![2]).length;
    expect((await sized('x'.repeat(500000 - base))).status).toBe('review');
    expect(JSON.stringify(generate.mock.lastCall![2])).toHaveLength(500000);
    generate.mockClear();
    expect(await sized('x'.repeat(500001 - base))).toMatchObject({
      status: 'failed',
      error: 'This batch contains too much document evidence. Select fewer files.',
    });
    expect(generate).not.toHaveBeenCalled();
  });
  it.each([
    [
      'the same file twice',
      [modelRow('0', 'C.txt'), modelRow('0', 'D.txt')],
      'The model proposed the same file twice.',
      ['C.txt'],
    ],
    [
      'an index outside the request',
      [modelRow('0', 'C.txt'), modelRow('2', 'D.txt')],
      'The model proposed an unknown file.',
      ['C.txt'],
    ],
    [
      'a non-canonical index',
      [modelRow('0', 'C.txt'), modelRow('01', 'D.txt')],
      'The model proposed an unknown file.',
      ['C.txt'],
    ],
    [
      'fewer files than requested',
      [modelRow('1', 'D.txt')],
      'The model omitted files. Retry with a smaller batch.',
      ['D.txt'],
    ],
  ])(
    'fails a response that names %s, keeping the rows reviewed before it',
    async (_case, rows, error, kept) => {
      await modelPlanner('rename', { data: 'names' }, { generate: respond(...rows) });
      const plan = await propose('rename');
      expect(plan).toMatchObject({ status: 'failed', error });
      expect(plan.rows.map((row) => path.basename(row.destination))).toEqual(kept);
    },
  );
  it.each([
    ['a field of the wrong type', [{ sourceID: 0 }], /^rows\.0\.sourceID: /],
    [
      'an unknown evidence field',
      [modelRow('0', 'C.txt', { evidence: [{ field: 'edition', source: 'text', text: 'One' }] })],
      /^rows\.0\.evidence\.0\.field: /,
    ],
    [
      'more than 20 quotes in a row',
      [
        modelRow('0', 'C.txt', {
          evidence: Array.from({ length: 21 }, () => ({
            field: 'title',
            source: 'text',
            text: 'T',
          })),
        }),
      ],
      /^rows\.0\.evidence: /,
    ],
    [
      'more than 2,000 rows',
      Array.from({ length: 2001 }, (_, index) => modelRow(String(index), index + '.txt')),
      /^rows: /,
    ],
  ])('fails a response with %s', async (_case, rows, error) => {
    await modelPlanner('rename', { data: 'names' }, { generate: respond(...rows) });
    const plan = await propose('rename');
    expect(plan).toMatchObject({ status: 'failed', rows: [] });
    expect(plan.error).toMatch(error);
  });
  it('marks destinations outside the request; the last failed rule wins', async () => {
    const issues = async (recipeID: string, ...rows: unknown[]) => {
      await modelPlanner(recipeID, { data: 'names' }, { generate: respond(...rows) });
      const plan = await propose(recipeID);
      expect(plan.status).toBe('review');
      return plan.rows.map((row) => [row.issue, row.approved]);
    };
    expect(await issues('rename', modelRow('0', 'Sub/A.txt'), modelRow('1', 'B.md'))).toEqual([
      ['Rename must contain only a filename.', false],
      ['Keep the original extension.', false],
    ]);
    expect(
      await issues('rename', modelRow('0', '../A.md'), modelRow('1', path.join(root, 'B.txt'))),
    ).toEqual([
      ['The destination is outside this action’s scope.', false],
      ['The destination is outside this action’s scope.', false],
    ]);
    expect(
      await issues('organize', modelRow('0', 'Sorted/A.txt'), modelRow('1', '../B.txt')),
    ).toEqual([
      [undefined, true],
      ['The destination is outside this action’s scope.', false],
    ]);
  });
  it('marks shared and existing destinations', async () => {
    await writeFile(at('C.txt'), 'existing');
    const issues = async (...rows: unknown[]) => {
      await modelPlanner('rename', { data: 'names' }, { generate: respond(...rows) });
      const plan = await propose('rename');
      expect(plan.status).toBe('review');
      return plan.rows.map((row) => [row.issue, row.approved]);
    };
    expect(await issues(modelRow('0', 'D.txt'), modelRow('1', 'd.txt'))).toEqual([
      ['Two files have the same destination.', false],
      ['Two files have the same destination.', false],
    ]);
    expect(await issues(modelRow('0', 'C.txt'), modelRow('1', 'b.txt'))).toEqual([
      ['The destination already exists. Edit the name.', false],
      [undefined, true],
    ]);
  });
  it('fails planning on a filename over 255 bytes with the system error', async () => {
    // checkRows records "The filename is too long." and then looks the name up, which throws.
    await modelPlanner(
      'rename',
      { data: 'names' },
      { generate: respond(modelRow('0', 'x'.repeat(252) + '.txt'), modelRow('1', 'D.txt')) },
    );
    const plan = await propose('rename');
    expect(plan.status).toBe('failed');
    expect(plan.error).toMatch(/^ENAMETOOLONG: /);
  });
  describe('publication names', () => {
    const book = () => at('Book.epub');
    const fields = {
      year: '2000',
      authors: 'J. E. Rehder',
      title: 'Fire in antiquity',
      publisher: 'Fixture Press',
    };
    const quotes = [
      { field: 'year', source: 'publication:date', text: '2000' },
      { field: 'authors', source: 'publication:creator', text: 'John E. Rehder' },
      { field: 'title', source: 'publication:title', text: 'Fire in antiquity' },
      { field: 'publisher', source: 'publication:publisher', text: 'Fixture Press' },
    ];
    const named = '2000, J. E. Rehder, Fire in antiquity, Fixture Press.epub';
    const unresolved = 'Unresolved publication evidence. Review and edit the name.';
    it.each([
      ['every field quoted', {}, named, undefined],
      [
        'a field missing',
        { fields: { ...fields, publisher: null } },
        '2000, J. E. Rehder, Fire in antiquity, [publisher].epub',
        unresolved,
      ],
      ['a field without a quote', { evidence: quotes.slice(0, 3) }, named, unresolved],
      [
        'a quote absent from its source',
        { evidence: [...quotes.slice(0, 3), { ...quotes[3]!, text: 'Other Press' }] },
        named,
        unresolved,
      ],
      [
        'a quote from another source',
        { evidence: [...quotes.slice(0, 3), { ...quotes[3]!, source: 'publication:title' }] },
        named,
        unresolved,
      ],
      [
        'a blank quote',
        { evidence: [...quotes.slice(0, 3), { ...quotes[3]!, text: ' ' }] },
        named,
        unresolved,
      ],
    ])('names a book from the model with %s', async (_case, patch, name, issue) => {
      await writeFile(book(), 'fixture');
      await modelPlanner(
        'book-name',
        {},
        {
          extract: async (file) =>
            document(file, {
              evidence: [
                { source: 'publication:date', text: 'Published 2000' },
                { source: 'publication:creator', text: 'John  E.\nRehder' },
                { source: 'publication:title', text: 'Fire in antiquity' },
                { source: 'publication:publisher', text: 'Fixture Press' },
              ],
            }),
          generate: respond(modelRow('0', 'Ignored.epub', { fields, evidence: quotes, ...patch })),
        },
      );
      const plan = await propose('book-name', { context: { ...context(), sources: [book()] } });
      expect(plan.status).toBe('review');
      expect(plan.rows[0]).toMatchObject({ destination: at(name), approved: !issue });
      expect(plan.rows[0]!.issue).toBe(issue);
    });
    it('records each quote as field and source', async () => {
      await writeFile(book(), 'fixture');
      await modelPlanner(
        'book-name',
        {},
        {
          extract: async (file) => document(file),
          generate: respond(modelRow('0', '', { fields, evidence: quotes.slice(0, 1) })),
        },
      );
      const plan = await propose('book-name', { context: { ...context(), sources: [book()] } });
      expect(plan.rows[0]!.evidence).toEqual([{ source: 'year · publication:date', text: '2000' }]);
    });
  });
  it('accumulates summaries in response order without rows', async () => {
    await modelPlanner(
      'summarize',
      { data: 'names' },
      {
        generate: respond(
          modelRow('1', '', { summary: 'About B' }),
          modelRow('0', '', { summary: 'About A' }),
        ),
      },
    );
    const plan = await propose('summarize');
    expect(plan).toMatchObject({
      status: 'review',
      rows: [],
      summary: '\n\n## B.txt\n\nAbout B\n\n## A.txt\n\nAbout A',
    });
    expect(plan.summaryInputs?.map((file) => file.name)).toEqual(['A.txt', 'B.txt']);
    await modelPlanner(
      'summarize',
      { data: 'names' },
      {
        generate: respond(
          modelRow('0', '', { summary: 'About A' }),
          modelRow('0', '', { summary: 'Again' }),
        ),
      },
    );
    expect(await propose('summarize')).toMatchObject({
      status: 'failed',
      error: 'The model proposed the same file twice.',
      summary: '\n\n## A.txt\n\nAbout A',
    });
  });
});
describe('applying a reviewed plan', () => {
  it('refuses an approval it cannot apply, before any change', async () => {
    const plan = await batch();
    const approval = approve(plan);
    const none = approval.rows.map((row) => ({ ...row, approved: false }));
    const stale = 'This proposal changed. Review its current version.';
    await refuses(planner.apply({ ...approval, revision: plan.revision - 1 }), stale);
    await refuses(planner.apply({ ...approval, id: 'missing' }), stale);
    await refuses(
      planner.apply({
        ...approval,
        rows: [...none, { id: 'extra', destination: at('C.txt'), approved: false }],
      }),
      'Unknown proposal row.',
    );
    await refuses(planner.apply({ ...approval, rows: none }), 'Select at least one change.');
    expect((await planner.get(plan.id)).revision).toBe(plan.revision);
    await planner.apply(approval);
    await refuses(planner.apply(approve(await planner.get(plan.id))), stale);
    await planner.close();
    await refuses(planner.apply(approval), 'Actions have closed.');
  });
  it('republishes the plan with its conflicts and moves nothing', async () => {
    const plan = await batch();
    await writeFile(plan.rows[0]!.destination, 'concurrent', { flag: 'wx' });
    await refuses(planner.apply(approve(plan)), 'Resolve the selected conflicts before applying.');
    const current = await planner.get(plan.id);
    expect(current).toMatchObject({ status: 'review', revision: plan.revision + 1 });
    expect(current.rows.map((row) => [row.issue, row.approved])).toEqual([
      ['The destination already exists. Edit the name.', false],
      [undefined, true],
    ]);
    expect(await readFile(at('A.txt'), 'utf8')).toBe('original A');
  });
  it('refuses a source changed after planning and a destination escaping through a link', async () => {
    const plan = await batch();
    await writeFile(at('B.txt'), 'changed B');
    await refuses(
      planner.apply(approve(plan)),
      'A source changed after planning. Run the action again.',
    );
    expect((await planner.get(plan.id)).status).toBe('review');
    await mkdir(path.join(root, 'elsewhere'));
    await symlink(path.join(root, 'elsewhere'), at('escape'));
    const next = approve(await batch());
    next.rows[0]!.destination = path.join(at('escape'), 'A.txt');
    await refuses(
      planner.apply(next),
      'The destination escapes the selected file scope through a symbolic link.',
    );
  });
  it('asks for access to the sources, destinations and originals', async () => {
    const access = vi.fn<NonNullable<Dependencies['access']>>(async () => {});
    await reopen({ access });
    const plan = await batch();
    await planner.apply(approve(plan));
    expect(access.mock.lastCall).toEqual([
      [at('A.txt'), at('B.txt'), at('New A.txt'), at('A.txt'), at('New B.txt'), at('B.txt')],
    ]);
  });
  it('stages the whole selection, then publishes each row, journaling every step', async () => {
    const emitted: ActionPlan[] = [];
    let stepLog = '';
    let steps: unknown[] = [];
    const changed = vi.fn<Dependencies['changed']>(() => {
      steps = readFileSync(stepLog, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
    });
    await reopen({ emit: (plan) => emitted.push(plan), changed });
    const plan = await batch();
    stepLog = path.join(root, `action-steps-${plan.id}.jsonl`);
    emitted.length = 0;
    const staged: string[] = [];
    intercept({
      before: async (_source, destination) => {
        if (staging(destination)) staged.push(destination);
      },
    });
    await planner.apply(approve(plan));
    const [a, b] = plan.rows;
    expect(steps).toEqual([
      { row: a!.id, stagedPath: staged[0] },
      { row: a!.id, stagedPath: staged[0] },
      { row: b!.id, stagedPath: staged[1] },
      { row: b!.id, stagedPath: staged[1] },
      { row: a!.id, completed: true },
      { row: b!.id, completed: true },
    ]);
    expect(changed).toHaveBeenCalledExactlyOnceWith([
      { source: at('A.txt'), destination: at('New A.txt') },
      { source: at('B.txt'), destination: at('New B.txt') },
    ]);
    expect(
      emitted.map((item) => item.status).filter((status, index, all) => status !== all[index - 1]),
    ).toEqual(['applying', 'completed']);
    expect(emitted.at(-1)).toMatchObject({ status: 'completed', undoable: true });
    expect(emitted.at(-1)!.rows.map((row) => [row.completed, row.stagedPath])).toEqual([
      [true, undefined],
      [true, undefined],
    ]);
  });
  it('takes a checkpoint of the sources before staging and records it', async () => {
    let listing: string[] = [];
    const snapshot = vi.fn<NonNullable<Dependencies['snapshot']>>(async () => {
      listing = (await readdir(files)).sort();
      return 'checkpoint-one';
    });
    await reopen({ snapshot });
    const plan = await batch();
    await planner.apply({ ...approve(plan), checkpoint: true });
    expect(snapshot).toHaveBeenCalledExactlyOnceWith(
      'Batch rename',
      [at('A.txt'), at('B.txt')],
      expect.any(AbortSignal),
    );
    expect(listing).toEqual(['A.txt', 'B.txt']);
    expect(await planner.get(plan.id)).toMatchObject({
      status: 'completed',
      checkpointID: 'checkpoint-one',
    });
  });
  it('fails without moving anything when checkpoints are unavailable', async () => {
    const plan = await batch();
    await planner.apply({ ...approve(plan), checkpoint: true });
    expect(await planner.get(plan.id)).toMatchObject({
      status: 'failed',
      error: 'Checkpoints are unavailable in this build.',
      undoable: false,
    });
    expect((await readdir(files)).sort()).toEqual(['A.txt', 'B.txt']);
  });
  it('fails when a source changes before its operation', async () => {
    await reopen({
      snapshot: async () => {
        await writeFile(at('A.txt'), 'changed A');
        return 'checkpoint-one';
      },
    });
    const plan = await batch();
    await planner.apply({ ...approve(plan), checkpoint: true });
    expect(await planner.get(plan.id)).toMatchObject({
      status: 'failed',
      error: 'A source changed before its operation.',
    });
    expect(await readFile(at('A.txt'), 'utf8')).toBe('changed A');
    expect(await stagedFiles()).toEqual([]);
  });
  it('restores a staged original when the next source changes before staging', async () => {
    const plan = await batch();
    intercept({
      after: async (source, destination) => {
        if (staging(destination) && path.basename(source) === 'A.txt')
          await writeFile(at('B.txt'), 'changed B');
      },
    });
    await planner.apply(approve(plan));
    expect(await planner.get(plan.id)).toMatchObject({
      status: 'failed',
      error: 'A source changed immediately before its operation.',
    });
    expect(await readFile(at('A.txt'), 'utf8')).toBe('original A');
    expect(await stagedFiles()).toEqual([]);
  });
  it('keeps the recorded staging path when a source changes while its provider waits', async () => {
    const plan = await batch();
    intercept({
      before: async (source, destination) => {
        if (staging(destination) && path.basename(source) === 'A.txt')
          await writeFile(at('A.txt'), 'changed A');
      },
    });
    await planner.apply(approve(plan));
    const current = await planner.get(plan.id);
    expect(current).toMatchObject({
      status: 'partial',
      error: 'A source changed while waiting for its file provider.',
    });
    expect(current.rows[0]!.stagedPath).toBeDefined();
    expect(await stagedFiles()).toEqual([]);
    expect(await readFile(at('A.txt'), 'utf8')).toBe('changed A');
  });
  it('preserves a staged file that changed, and restores the others', async () => {
    const plan = await batch();
    const staged: string[] = [];
    intercept({
      after: async (source, destination) => {
        if (!staging(destination)) return;
        staged.push(destination);
        if (path.basename(source) === 'B.txt') await appendFile(staged[0]!, ' edited');
      },
    });
    await planner.apply(approve(plan));
    const current = await planner.get(plan.id);
    expect(current).toMatchObject({
      status: 'partial',
      error: 'A staged source changed; it was preserved for recovery.',
      undoable: false,
    });
    expect(current.rows.map((row) => row.stagedPath)).toEqual([staged[0], undefined]);
    expect(await readFile(staged[0]!, 'utf8')).toBe('original A edited');
    expect(await readFile(at('B.txt'), 'utf8')).toBe('original B');
    expect(await stagedFiles()).toEqual([path.basename(staged[0]!)]);
  });
  it('preserves a staged file that changed while its provider waits', async () => {
    const plan = await batch();
    intercept({
      before: async (source, destination) => {
        if (path.basename(destination) === 'New A.txt') await appendFile(source, ' edited');
      },
    });
    await planner.apply(approve(plan));
    const current = await planner.get(plan.id);
    expect(current).toMatchObject({
      status: 'partial',
      error: 'A staged source changed while waiting for its file provider.',
    });
    expect(await readFile(current.rows[0]!.stagedPath!, 'utf8')).toBe('original A edited');
    expect(await readFile(at('B.txt'), 'utf8')).toBe('original B');
  });
  it('reports partial when a later row fails after an earlier one completed', async () => {
    const changed = vi.fn<Dependencies['changed']>();
    await reopen({ changed });
    const plan = await batch();
    intercept({
      before: async (_source, destination) => {
        if (path.basename(destination) === 'New B.txt')
          await writeFile(destination, 'race', { flag: 'wx' });
      },
    });
    await planner.apply(approve(plan));
    const current = await planner.get(plan.id);
    expect(current).toMatchObject({ status: 'partial', undoable: false });
    expect(current.error).toBeTruthy();
    expect(current.rows.map((row) => [row.completed, row.stagedPath])).toEqual([
      [true, undefined],
      [undefined, undefined],
    ]);
    expect(changed).toHaveBeenCalledExactlyOnceWith([
      { source: at('A.txt'), destination: at('New A.txt') },
    ]);
    expect(await readFile(at('New A.txt'), 'utf8')).toBe('original A');
    expect(await readFile(at('B.txt'), 'utf8')).toBe('original B');
    expect(await readFile(at('New B.txt'), 'utf8')).toBe('race');
  });
  it('leaves a staged original in place when its original path was taken', async () => {
    const plan = await batch();
    const staged: string[] = [];
    intercept({
      before: async (_source, destination) => {
        if (staging(destination)) staged.push(destination);
        if (path.basename(destination) !== 'New A.txt') return;
        await writeFile(at('A.txt'), 'squatter', { flag: 'wx' });
        throw new Error('Publication failed.');
      },
    });
    await planner.apply(approve(plan));
    const current = await planner.get(plan.id);
    expect(current).toMatchObject({ status: 'partial', error: 'Publication failed.' });
    expect(current.rows.map((row) => row.stagedPath)).toEqual([staged[0], undefined]);
    expect(await readFile(staged[0]!, 'utf8')).toBe('original A');
    expect(await readFile(at('A.txt'), 'utf8')).toBe('squatter');
    expect(await readFile(at('B.txt'), 'utf8')).toBe('original B');
  });
  it('cancels before anything is staged', async () => {
    let id = '';
    await reopen({
      snapshot: async () => {
        planner.cancel(id);
        return 'checkpoint-one';
      },
    });
    const plan = await batch();
    id = plan.id;
    await planner.apply({ ...approve(plan), checkpoint: true });
    expect(await planner.get(id)).toMatchObject({ status: 'cancelled', undoable: false });
    expect((await readdir(files)).sort()).toEqual(['A.txt', 'B.txt']);
  });
  it('cancels after staging, restoring the staged original', async () => {
    const plan = await batch();
    intercept({
      after: async (_source, destination) => {
        if (staging(destination)) planner.cancel(plan.id);
      },
    });
    await planner.apply(approve(plan));
    expect(await planner.get(plan.id)).toMatchObject({ status: 'cancelled', undoable: false });
    expect((await readdir(files)).sort()).toEqual(['A.txt', 'B.txt']);
  });
  it('reports partial when cancelled after a row completed', async () => {
    const plan = await batch();
    intercept({
      after: async (_source, destination) => {
        if (path.basename(destination) === 'New A.txt') planner.cancel(plan.id);
      },
    });
    await planner.apply(approve(plan));
    expect(await planner.get(plan.id)).toMatchObject({ status: 'partial', undoable: false });
    expect((await readdir(files)).sort()).toEqual(['B.txt', 'New A.txt']);
  });
  it('writes an exported summary as a new private file', async () => {
    await modelPlanner(
      'summarize',
      { data: 'names' },
      {
        generate: respond(
          modelRow('0', '', { summary: 'About A' }),
          modelRow('1', '', { summary: 'About B' }),
        ),
      },
    );
    const plan = await propose('summarize');
    const destination = at('Summary.md');
    await planner.exportSummary(plan.id, destination);
    await planner.apply(approve(await planner.get(plan.id)));
    expect(await readFile(destination, 'utf8')).toBe(plan.summary);
    expect((await stat(destination)).mode & 0o777).toBe(0o600);
    expect(await planner.get(plan.id)).toMatchObject({ status: 'completed', undoable: false });
  });
  it('creates a folder row recorded in the journal', async () => {
    const plan = await batch();
    plan.rows = [
      { id: 'folder', kind: 'mkdir', destination: at('Folder'), evidence: [], approved: true },
    ];
    await planner.close();
    await writeFile(path.join(root, 'action-journal-v1.json'), JSON.stringify([plan]));
    planner = create();
    await planner.apply(approve(await planner.get(plan.id)));
    expect((await stat(at('Folder'))).isDirectory()).toBe(true);
    expect(await planner.get(plan.id)).toMatchObject({ status: 'completed', undoable: false });
  });
});
describe('scoped proposal-only MCP broker', () => {
  it('requires authentication, enforces canonical scopes and never advertises apply/delete tools', async () => {
    settings.agents = { enabled: true, roots: [files], allowLayout: false };
    const profile = path.join(root, 'Profile');
    const broker = new AgentBroker(
      profile,
      () => settings,
      context,
      {
        query: async () => ({
          entries: [],
          indexed: true,
          more: false,
          status: { roots: [], count: 0, running: false },
        }),
      } as unknown as FileServices,
      planner,
    );
    const consent = {
      enabled: true,
      add: [files],
      capabilities: ['metadata', 'propose'] as const,
    };
    await broker.access.approve(consent, await broker.access.captureReview(consent));
    const token = await broker.credential();
    await Promise.all([broker.start(), broker.start()]);
    const connection = JSON.parse(
      await readFile(path.join(profile, 'agent-connection-v1.json'), 'utf8'),
    ) as { socket: string };
    expect(Buffer.byteLength(connection.socket)).toBeLessThan(104);
    expect((await stat(connection.socket)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(connection.socket))).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(profile, 'agent-token-v1.json'))).mode & 0o777).toBe(0o600);
    settings.agents.roots = [root];
    await expect(broker.authorize(path.join(profile, 'agent-token-v1.json'))).rejects.toThrow(
      'Private Viewer',
    );
    await symlink(path.join(profile, 'agent-token-v1.json'), path.join(files, 'private-token'));
    await expect(broker.authorize(path.join(files, 'private-token'))).rejects.toThrow(
      'Private Viewer',
    );
    settings.agents.roots = [files];
    const list = (await broker.handle(token, { method: 'tools/list' })) as {
      tools: { name: string }[];
    };
    expect(list.tools.some((tool) => /apply|delete|trash/.test(tool.name))).toBe(false);
    await expect(broker.handle('invalid', { method: 'tools/list' })).rejects.toThrow('invalid');
    await expect(
      broker.handle(token, { method: 'tools/call', params: { name: 'apply', arguments: {} } }),
    ).rejects.toThrow('Unknown agent tool');
    const outside = path.join(root, 'private.txt');
    await writeFile(outside, 'outside');
    await symlink(outside, path.join(files, 'link'));
    await expect(broker.authorize(path.join(files, 'link'))).rejects.toThrow('outside');
    expect(await broker.authorize(path.join(files, 'A.txt'))).toBe(
      await realpath(path.join(files, 'A.txt')),
    );
    const call = (await broker.handle(token, {
      method: 'tools/call',
      params: {
        name: 'run_action',
        arguments: { recipeID: 'batch-rename', sources: [path.join(files, 'A.txt')] },
      },
    })) as { content: { text: string }[] };
    const id = JSON.parse(call.content[0].text).id;
    await planner.settled(id);
    expect((await planner.get(id)).context.actor).toBe('agent');
    expect(await readFile(path.join(files, 'A.txt'), 'utf8')).toBe('original A');
    settings.agents.enabled = false;
    await expect(broker.handle(token, { method: 'tools/list' })).rejects.toThrow('disabled');
    await broker.close();
    await expect(stat(connection.socket)).rejects.toThrow();
    if (process.env.VIEWER_TEST_PRESERVE === '1' || process.env.VIEWER_TEST_NO_REMOVAL === '1')
      expect((await stat(path.dirname(connection.socket))).isDirectory()).toBe(true);
    else await expect(stat(path.dirname(connection.socket))).rejects.toThrow();
  });
});
