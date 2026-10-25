import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DocumentStore } from '../src/desktop/persistence/document-store';
import {
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
import { defaultSettings, type ActionPlan, type ApplicationSettings } from '../src/domain/services';
import { epubFixture } from './fixtures';
import { extractDocument } from '../src/desktop/previews/formats';
import type { FileServices } from '../src/desktop/files/file-services';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import { removalBlocked } from './support/preservation';
let root: string,
  files: string,
  planner: ActionPlanner,
  operations: Operations,
  settings: ApplicationSettings;
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
const create = () =>
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
describe('reviewed file action transactions', () => {
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
