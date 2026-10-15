import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, realpath, writeFile, readFile, readdir, rename, symlink } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { Workflows } from '../src/desktop/workflows';
import { WatchRules } from '../src/desktop/watch-rules';
import { Operations } from '../src/desktop/operations';
import { OperationPlans } from '../src/desktop/operation-plans';
import { Checkpoints } from '../src/desktop/checkpoints';
import { Comparisons } from '../src/desktop/comparison';
import { ActionPlanner } from '../src/desktop/actions/planner';
import { inspectFile } from '../src/desktop/inspection';
import {
  workflowDefinitionSchema,
  type WorkflowRun,
  type WorkflowDocument,
} from '../src/domain/workflows';
import type { WatchRule, WatchRuleScope } from '../src/domain/watch-rules';
import type { ActionRecipe } from '../src/domain/services';
import type { OperationPlan } from '../src/domain/operation-plan';
import type { DirectoryWatch, watchDirectory } from '../src/desktop/directory-watch';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

async function settle<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const value = await read();
    if (accept(value)) return value;
    await delay(10);
  }
  throw new Error('The generated watch rule did not settle.');
}
async function fixture(kind: 'copy' | 'inspect' | 'rename' = 'copy', content = false) {
  const root = await realpath(await temporaryRoot('viewer-watch-rule-'));
  const profile = path.join(root, 'Profile'),
    inbox = path.join(root, 'Inbox'),
    destination = path.join(root, 'Output');
  await Promise.all([profile, inbox, destination].map((folder) => mkdir(folder)));
  await writeFile(path.join(inbox, 'Existing.txt'), 'Do not run on preexisting files.');
  let denied = false,
    now = Date.now();
  const access = async (files: readonly string[]) => {
    if (denied && files.some((file) => file.startsWith(inbox)))
      throw new Error('Folder access was revoked.');
  };
  const events: WatchRule[] = [];
  const watches = new Map<string, Parameters<typeof watchDirectory>[1]>();
  const watch = (folder: string, options: Parameters<typeof watchDirectory>[1]): DirectoryWatch => {
    watches.set(folder, options);
    return {
      close: async () => {
        watches.delete(folder);
      },
    };
  };
  const operations = new Operations(
    (file) => rename(file, path.join(root, 'Trash-' + path.basename(file))),
    () => {},
    undefined,
    undefined,
    access,
    profile,
  );
  const checkpoints = new Checkpoints(path.join(profile, 'checkpoints'), access, () => 10485760);
  const plans = new OperationPlans(profile, operations, checkpoints, access);
  const comparisons = new Comparisons(access);
  let recipes: ActionRecipe[] = [
    {
      id: 'rename',
      name: 'Local rename',
      kind: 'batch-rename',
      formats: ['txt'],
      recursive: false,
      instructions: '',
      template: 'done-{name}',
      data: 'names',
    },
  ];
  const actions = new ActionPlanner(profile, {
    recipes: () => recipes,
    providers: () => [],
    operations,
    extract: async () => {
      throw new Error('No content extraction in local rename.');
    },
    generate: async () => {
      throw new Error('No provider call may originate from a rule.');
    },
    emit: () => {},
    changed: () => {},
  });
  let rules: WatchRules;
  let flows: Workflows;
  const open = () => {
    flows = new Workflows(profile, {
      access,
      files: { inspect: (file, content, _ocr, signal) => inspectFile(file, { content, signal }) },
      comparisons,
      plans,
      operations,
      actions,
      coordination: { run: async <T>(_intents: unknown, work: () => Promise<T>) => work() },
      authorizeRun: (run) => rules.authorize(run),
      recipeForRun: (run, id) => rules.recipeForRun(run, id),
    });
    rules = new WatchRules(profile, {
      access,
      workflows: flows,
      recipes: () => recipes,
      changed: (rule) => events.push(rule),
      watch,
      now: () => now,
    });
  };
  open();
  const definition = workflowDefinitionSchema.parse({
    version: 1,
    id: 'incoming',
    name: 'Incoming files',
    bindings: kind === 'copy' ? [{ name: 'output', label: 'Output' }] : [],
    inputs: kind === 'copy' ? { destination: { binding: 'output', path: '.' } } : {},
    steps: [
      { id: 'inspect', kind: 'inspect', sources: [{ kind: 'selection' }], content },
      ...(kind === 'copy'
        ? [
            {
              id: 'copy',
              kind: 'copy',
              needs: ['inspect'],
              sources: [{ kind: 'step', id: 'inspect' }],
              destination: { kind: 'input', name: 'destination' },
            },
          ]
        : []),
      ...(kind === 'rename'
        ? [
            {
              id: 'rename',
              kind: 'recipe',
              recipeID: 'rename',
              needs: ['inspect'],
              sources: [{ kind: 'step', id: 'inspect' }],
            },
          ]
        : []),
    ],
  });
  const document = (await flows!.request({
    kind: 'save',
    file: path.join(root, 'viewer.workflow.jsonc'),
    revision: '',
    definition,
  })) as WorkflowDocument;
  const scope: WatchRuleScope = {
    file: document.file,
    fileRevision: document.revision,
    root: inbox,
    bindings: kind === 'copy' ? { output: destination } : {},
    extensions: ['txt'],
    recursive: true,
    allowContent: content,
    cooldownSeconds: 30,
  };
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const tick = async (milliseconds = 1100) => {
    now += milliseconds;
    await vi.advanceTimersByTimeAsync(milliseconds);
    await delay(40);
  };
  return {
    root,
    profile,
    inbox,
    destination,
    document,
    scope,
    events,
    watches,
    actions,
    plans,
    operations,
    get rules() {
      return rules!;
    },
    get flows() {
      return flows!;
    },
    change: () => watches.get(inbox)?.changed(inbox),
    tick,
    approve: async (override: Partial<WatchRuleScope> = {}) =>
      (await rules!.request({ kind: 'approve', scope: { ...scope, ...override } })) as WatchRule,
    list: async () => (await rules!.request({ kind: 'list' })) as WatchRule[],
    run: async (id: string) => (await flows!.request({ kind: 'get', id })) as WorkflowRun,
    runs: async () => (await flows!.request({ kind: 'list' })) as WorkflowRun[],
    deny: () => {
      denied = true;
    },
    changeRecipe: (value: Partial<ActionRecipe>) => {
      recipes = recipes.map((recipe) => ({ ...recipe, ...value }));
    },
    reopen: async () => {
      await rules!.close();
      await flows!.close();
      open();
      await rules!.start();
    },
    close: async () => {
      await rules!.close();
      await flows!.close();
      comparisons.close();
      await actions.close();
      await plans.close();
      await operations.close();
      await checkpoints.close();
      vi.useRealTimers();
      await trashTemporary(root);
    },
  };
}
afterEach(() => vi.useRealTimers());
describe('approved incoming-file watch rules', () => {
  it('requires changed-file references, exact bindings, local recipes and explicit content approval', async () => {
    const f = await fixture('rename', true);
    try {
      await expect(f.approve({ allowContent: false })).rejects.toThrow('contents');
      await expect(f.approve({ root: f.profile })).rejects.toThrow('private');
      f.changeRecipe({ providerID: 'remote' });
      await expect(f.approve()).rejects.toThrow('Run model recipes manually');
      f.changeRecipe({ providerID: undefined });
      await expect(f.approve({ bindings: { undeclared: f.destination } })).rejects.toThrow(
        'binding',
      );
      expect(await f.runs()).toEqual([]);
      expect(f.watches.size).toBe(0);
      await expect(
        f.flows.request({
          kind: 'start',
          file: f.document.file,
          revision: f.document.revision,
          bindings: {},
          context: { actor: 'user', workspaceID: 'w', paneID: 'p', rootID: 'r', sources: [] },
        }),
      ).rejects.toThrow('Select the files');
      expect(await f.runs()).toEqual([]);
      const fixed = (await f.flows.request({
        kind: 'save',
        file: f.document.file,
        revision: f.document.revision,
        definition: workflowDefinitionSchema.parse({
          ...f.document.definition,
          inputs: { source: { path: 'Inbox/Existing.txt' } },
          steps: [{ id: 'inspect', kind: 'inspect', sources: [{ kind: 'input', name: 'source' }] }],
        }),
      })) as WorkflowDocument;
      await expect(f.approve({ fileRevision: fixed.revision })).rejects.toThrow(
        'selection reference',
      );
      await expect(
        f.flows.request({
          kind: 'start',
          file: f.document.file,
          revision: fixed.revision,
          bindings: {},
          context: { actor: 'user', workspaceID: 'w', paneID: 'p', rootID: 'r', sources: [] },
        }),
      ).resolves.toMatchObject({ status: 'running' });
      // The same definition remains usable as an explicit manual workflow.
    } finally {
      await f.close();
    }
  });
  it('skips existing files and escaping symlinks; queues one real editable copy plan per rule', async () => {
    const f = await fixture();
    try {
      const rule = await f.approve();
      await f.tick();
      expect(await f.runs()).toEqual([]);
      await writeFile(
        path.join(f.root, 'Secret.txt'),
        'Outside root despite the fixture’s broader permission.',
      );
      await symlink(path.join(f.root, 'Secret.txt'), path.join(f.inbox, 'Escaping.txt'));
      await writeFile(path.join(f.inbox, 'Ignore.csv'), 'ignored');
      await writeFile(path.join(f.inbox, 'New.txt'), 'Changed selection');
      f.change();
      await f.tick();
      const runs = await settle(f.runs, (value) => value[0]?.status === 'waiting-review');
      expect(runs[0].context.sources).toEqual([path.join(f.inbox, 'New.txt')]);
      expect(await readdir(f.destination)).toEqual([]);
      expect(f.operations.all()).toEqual([]);
      await writeFile(path.join(f.inbox, 'Later.txt'), 'Wait for existing review.');
      f.change();
      await f.tick(31000);
      expect(await f.runs()).toHaveLength(1);
      const waiting = await f.run(runs[0].id);
      const plan = (await f.plans.request({
        kind: 'get',
        id: waiting.steps[1].taskID!,
      })) as OperationPlan;
      await f.plans.request({
        kind: 'apply',
        id: plan.id,
        revision: plan.revision,
        checkpoint: false,
        rows: plan.rows.map((row) => ({ id: row.id, approved: true })),
      });
      await f.operations.exclusive(async () => {});
      await f.flows.request({ kind: 'resume', id: waiting.id });
      await settle(
        () => f.run(waiting.id),
        (run) => run.status === 'completed',
      );
      expect(await readFile(path.join(f.destination, 'New.txt'), 'utf8')).toBe('Changed selection');
      await f.tick(11000);
      const second = await settle(
        f.runs,
        (runs) => runs.length === 2 && runs[0].status === 'waiting-review',
      );
      expect(second[0].context.sources).toEqual([path.join(f.inbox, 'Later.txt')]);
      expect((await f.list())[0].id).toBe(rule.id);
      expect(f.events.some((event) => event.runStatus === 'waiting-review')).toBe(true);
    } finally {
      await f.close();
    }
  });
  it('restores approved watches on cold start and pauses on revision changes or revoked access', async () => {
    const f = await fixture('inspect');
    try {
      await f.approve();
      await f.reopen();
      expect(f.watches.size).toBe(1);
      expect(await f.runs()).toEqual([]);
      await writeFile(path.join(f.inbox, 'Cold.txt'), 'New file after restart.');
      f.change();
      await f.tick();
      await settle(f.runs, (runs) => runs[0]?.status === 'completed');
      await writeFile(
        f.document.file,
        '// Changed public scope\n' +
          JSON.stringify({ ...f.document.definition, name: 'Changed rule definition' }),
      );
      f.change();
      await f.tick(31000);
      await settle(f.list, (rules) => !rules[0].enabled);
      expect((await f.list())[0].reason).toContain('workflow changed');
      expect(f.watches.size).toBe(0);
      const fresh = (await f.flows.request({
        kind: 'read',
        file: f.document.file,
      })) as WorkflowDocument;
      const paused = (await f.list())[0];
      await f.rules.request({
        kind: 'approve',
        id: paused.id,
        revision: paused.revision,
        scope: { ...paused.scope, fileRevision: fresh.revision },
      });
      f.deny();
      await f.rules.revoke(f.inbox);
      expect((await f.list())[0]).toMatchObject({ enabled: false });
      expect(f.watches.size).toBe(0);
      expect(await f.runs()).toHaveLength(1);
    } finally {
      await f.close();
    }
  });
  it('stops bursts over 50 files and does not replay a run whose starting receipt was interrupted', async () => {
    const f = await fixture('inspect');
    try {
      await f.approve();
      await Promise.all(
        Array.from({ length: 51 }, (_, i) =>
          writeFile(path.join(f.inbox, i + '.txt'), 'generated'),
        ),
      );
      f.change();
      await f.tick();
      await settle(f.list, (rules) => !rules[0].enabled);
      expect((await f.list())[0].reason).toContain('50 files');
      expect(await f.runs()).toEqual([]);
      await f.rules.close();
      const file = path.join(f.profile, 'watch-rules-v1.json');
      const receipts = JSON.parse(await readFile(file, 'utf8'));
      receipts[0].enabled = true;
      receipts[0].starting = true;
      await writeFile(file, JSON.stringify(receipts));
      await f.reopen();
      expect((await f.list())[0]).toMatchObject({ enabled: false });
      expect((await f.list())[0].reason).toContain('stopped while starting');
      expect(f.watches.size).toBe(0);
    } finally {
      await f.close();
    }
  });
  it('does not retrigger a completed local rename and detects recipe changes before creating another proposal', async () => {
    const f = await fixture('rename');
    try {
      await f.approve();
      await writeFile(path.join(f.inbox, 'Model.txt'), 'generated');
      f.change();
      await f.tick();
      const run = (await settle(f.runs, (runs) => runs[0]?.status === 'waiting-review'))[0];
      const waiting = await f.run(run.id),
        taskID = waiting.steps[1].taskID!;
      await f.actions.settled(taskID);
      const plan = await f.actions.get(taskID);
      await f.actions.apply({
        id: plan.id,
        revision: plan.revision,
        checkpoint: false,
        rows: plan.rows.map((row) => ({
          id: row.id,
          destination: row.destination,
          approved: true,
        })),
      });
      await f.actions.settled(taskID);
      await f.flows.request({ kind: 'resume', id: run.id });
      await settle(
        () => f.run(run.id),
        (run) => run.status === 'completed',
      );
      f.change();
      await f.tick(31000);
      expect(await f.runs()).toHaveLength(1);
      f.changeRecipe({ template: 'changed-{name}' });
      await writeFile(path.join(f.inbox, 'Another.txt'), 'generated');
      f.change();
      await f.tick();
      await settle(f.list, (rules) => !rules[0].enabled);
      expect((await f.list())[0].reason).toContain('recipe');
      expect(await f.runs()).toHaveLength(1);
    } finally {
      await f.close();
    }
  });
  it('rejects a recipe changed after watch approval at the actual planner admission boundary', async () => {
    const f = await fixture('rename');
    try {
      const expected: ActionRecipe = {
        id: 'rename',
        name: 'Local rename',
        kind: 'batch-rename',
        formats: ['txt'],
        recursive: false,
        instructions: '',
        template: 'done-{name}',
        data: 'names',
      };
      f.changeRecipe({ kind: 'summarize', providerID: 'new-provider', data: 'full-text' });
      await expect(
        f.actions.start(
          {
            recipeID: 'rename',
            context: {
              workspaceID: 'w',
              rootID: 'r',
              paneID: 'p',
              actor: 'user',
              sources: [path.join(f.inbox, 'Existing.txt')],
            },
          },
          expected,
        ),
      ).rejects.toThrow('changed after approval');
      expect(await f.actions.all()).toEqual([]);
      expect(f.operations.all()).toEqual([]);
    } finally {
      await f.close();
    }
  });
});
