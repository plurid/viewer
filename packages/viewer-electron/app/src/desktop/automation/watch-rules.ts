import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { DocumentStore } from '../persistence/document-store';
import { watchDirectory, type DirectoryWatch } from '../files/directory-watch';
import { entry } from '../files/filesystem';
import { sourceVersion, sameSourceVersion } from '../../domain/files/inspection';
import { resolveProjectPath } from '../../domain/workspaces/project';
import { workflowReferences, workflowUsesSelection } from '../../domain/automation/workflows';
import {
  watchRuleRequestSchema,
  watchRuleSchema,
  type StoredWatchRule,
  type WatchRule,
  type WatchRuleScope,
  type WatchRuleRequest,
  type WatchRuleReply,
} from '../../domain/automation/watch-rules';
import type { WorkflowDocument, WorkflowRun } from '../../domain/automation/workflows';
import type { ActionRecipe } from '../../domain/services';
import type { Workflows } from './workflows';

const within = (root: string, file: string) => {
  const relative = path.relative(root, file);
  return (
    !relative ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
  );
};
const pending = (status?: WorkflowRun['status']) =>
  !!status && ['running', 'paused', 'waiting-review'].includes(status);
function publicRule(rule: StoredWatchRule): WatchRule {
  const { baseline: _baseline, approval: _approval, ...visible } = rule;
  return structuredClone(visible);
}
interface OwnedWatch {
  watcher: DirectoryWatch;
  timer?: ReturnType<typeof setTimeout>;
}
/** A private approval enables a bounded incoming-file workflow. It never applies its proposals. */
export class WatchRules {
  private store: DocumentStore<StoredWatchRule[]>;
  private rules = new Map<string, StoredWatchRule>();
  private watches = new Map<string, OwnedWatch>();
  private loaded?: Promise<void>;
  private controls: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private closed = false;
  constructor(
    private directory: string,
    private dependencies: {
      access(files: readonly string[]): Promise<void>;
      workflows: Pick<Workflows, 'request' | 'definitions'>;
      recipes(): ActionRecipe[];
      changed(rule: WatchRule): void;
      watch?: typeof watchDirectory;
      now?(): number;
    },
  ) {
    this.store = new DocumentStore(path.join(directory, 'watch-rules-v1.json'), (value) =>
      z.array(watchRuleSchema).max(20).parse(value),
    );
  }
  private now() {
    return this.dependencies.now?.() ?? Date.now();
  }
  private async load() {
    return (this.loaded ??= (async () => {
      await mkdir(this.directory, { recursive: true });
      for (const rule of (await this.store.load()) ?? []) this.rules.set(rule.id, rule);
    })().catch((error: unknown) => {
      // A failed read is retried by the next caller instead of disabling this service.
      this.loaded = undefined;
      throw error;
    }));
  }
  private save() {
    return this.store.save([...this.rules.values()]);
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Watch rules have closed.'));
    if (this.queued >= 32) return Promise.reject(new Error('Too many watch rule requests.'));
    this.queued++;
    const task = this.controls
      .catch(() => {})
      .then(async () => {
        if (this.closed) throw new Error('Watch rules have closed.');
        await this.load();
        return work();
      })
      .finally(() => this.queued--);
    this.controls = task;
    return task;
  }
  /** Restore only previously approved private rules; reading a workflow cannot enable one. */
  async start() {
    await this.serial(async () => {
      for (const rule of this.rules.values()) {
        if (!rule.enabled || this.watches.has(rule.id)) continue;
        try {
          if (rule.starting)
            throw new Error(
              'Viewer stopped while starting a run. Check workflow history before enabling this rule again.',
            );
          await this.check(rule);
          this.attach(rule);
          this.schedule(rule);
        } catch (error) {
          await this.stop(rule, (error as Error).message);
        }
      }
    });
  }
  request(input: WatchRuleRequest): Promise<WatchRuleReply> {
    const request = watchRuleRequestSchema.parse(input);
    return this.serial(async () => {
      if (request.kind === 'list') return [...this.rules.values()].map(publicRule);
      const old = 'id' in request && request.id ? this.rules.get(request.id) : undefined;
      if ('id' in request && request.id && (!old || old.revision !== request.revision))
        throw new Error('This rule changed. Reload its settings before continuing.');
      if (request.kind === 'approve') {
        if (!old && this.rules.size >= 20) throw new Error('Use at most 20 watch rules.');
        if (old) await this.refresh(old);
        if (old && pending(old.runStatus))
          throw new Error('Finish or cancel the existing workflow run before changing its rule.');
        const scope = structuredClone(request.scope);
        scope.root = await realpath(scope.root);
        scope.file = await realpath(scope.file);
        for (const [name, folder] of Object.entries(scope.bindings))
          scope.bindings[name] = await realpath(folder);
        scope.extensions = [...new Set(scope.extensions)].sort();
        const document = await this.dependencies.workflows.definitions.read(scope.file);
        const details = await this.scope(scope, document);
        const rule: StoredWatchRule = {
          id: old?.id ?? randomUUID(),
          revision: (old?.revision ?? 0) + 1,
          name: document.definition.name,
          scope,
          approval: details.approval,
          enabled: true,
          created: old?.created ?? this.now(),
          baseline: [],
        };
        // Capture existing files as the baseline; enabling a rule never processes the entire folder.
        rule.baseline = await this.scan(rule, details.excluded);
        if (old) await this.detach(old.id);
        this.rules.set(rule.id, rule);
        try {
          await this.save();
        } catch (error) {
          if (old) this.rules.set(old.id, old);
          else this.rules.delete(rule.id);
          throw error;
        }
        this.attach(rule);
        this.schedule(rule);
        this.dependencies.changed(publicRule(rule));
        return publicRule(rule);
      }
      if (!old) throw new Error('This watch rule is unavailable.');
      if (request.kind === 'pause') {
        await this.stop(old, 'Paused by you.');
        return publicRule(old);
      }
      await this.refresh(old);
      if (pending(old.runStatus))
        throw new Error('Finish or cancel the existing workflow run before removing its rule.');
      await this.detach(old.id);
      this.rules.delete(old.id);
      await this.save();
      return null;
    });
  }
  private async scope(scope: WatchRuleScope, document: WorkflowDocument) {
    if (document.revision !== scope.fileRevision)
      throw new Error(
        'The workflow changed. Review its current definition and enable the rule again.',
      );
    const privateRoot = await realpath(this.directory);
    if (within(privateRoot, scope.root))
      throw new Error('Choose a folder outside Viewer’s private application data.');
    if (within(privateRoot, scope.file) || (await realpath(scope.file)) !== scope.file)
      throw new Error('Choose a workflow outside Viewer’s private application data.');
    const names = new Set(document.definition.bindings.map((binding) => binding.name));
    if (
      names.size !== Object.keys(scope.bindings).length ||
      Object.keys(scope.bindings).some((name) => !names.has(name))
    )
      throw new Error('Choose every declared workflow binding before enabling this rule.');
    await this.dependencies.access([scope.root, scope.file, ...Object.values(scope.bindings)]);
    const root = await lstat(scope.root);
    if (!root.isDirectory() || root.isSymbolicLink() || (await realpath(scope.root)) !== scope.root)
      throw new Error('The watched folder moved or is unavailable. Choose it again.');
    if (!workflowUsesSelection(document.definition))
      throw new Error('A watch workflow must use a selection reference for changed files.');
    const excluded = [privateRoot, scope.file];
    const recipes: ActionRecipe[] = [];
    const inputPaths: string[] = [];
    for (const step of document.definition.steps) {
      if (step.kind === 'compare')
        throw new Error(
          'Run comparison workflows manually. Watch rules support inspection, copy and local rename steps.',
        );
      if (step.kind === 'inspect' && (step.content || step.ocr) && !scope.allowContent)
        throw new Error(
          'This workflow reads file contents. Enable content access for this rule or use metadata inspection.',
        );
      for (const ref of step.sources) {
        if (ref.kind === 'input')
          throw new Error(
            'Watched sources must use selection or a previous step’s outputs. Fixed inputs are only for copy destinations.',
          );
      }
      if (step.kind === 'recipe') {
        const recipe = this.dependencies.recipes().find((recipe) => recipe.id === step.recipeID);
        if (
          !recipe ||
          recipe.kind !== 'batch-rename' ||
          recipe.providerID ||
          recipe.data !== 'names' ||
          recipe.recursive
        )
          throw new Error(
            'Watch rules support nonrecursive local batch rename recipes only. Run model recipes manually.',
          );
        recipes.push(recipe);
      }
      if (step.kind === 'copy') {
        if (step.destination.kind !== 'input')
          throw new Error('Use a fixed destination input for watched copies.');
        const folder = resolveProjectPath(
          document.root,
          document.definition.inputs[step.destination.name],
          scope.bindings,
        );
        if (!folder) throw new Error('Choose the destination folder binding.');
        await this.dependencies.access([folder]);
        const target = await realpath(folder);
        if (within(privateRoot, target))
          throw new Error('Choose a destination outside Viewer’s private application data.');
        if (!(await lstat(target)).isDirectory()) throw new Error('Choose a destination folder.');
        if (within(target, scope.root))
          throw new Error(
            'The copy destination must be outside or strictly inside the watched folder, not the watched folder itself or its parent.',
          );
        excluded.push(target);
        inputPaths.push(target);
      }
    }
    return {
      excluded,
      approval: createHash('sha256')
        .update(JSON.stringify({ scope, recipes, inputPaths }))
        .digest('hex'),
    };
  }
  private async check(rule: StoredWatchRule) {
    if (!rule.enabled) throw new Error(rule.reason ?? 'This watch rule is paused.');
    const document = await this.dependencies.workflows.definitions.read(rule.scope.file);
    const result = await this.scope(rule.scope, document);
    if (result.approval !== rule.approval)
      throw new Error(
        'The workflow, recipe or destination changed. Review the rule and enable it again.',
      );
    return result;
  }
  /** Called before each watched workflow step and before an explicit Resume. */
  async authorize(run: WorkflowRun): Promise<void> {
    if (!run.watch) return;
    await this.load();
    const rule = this.rules.get(run.watch.id);
    if (this.closed || !rule || run.watch.approval !== rule.approval)
      throw new Error('This watch rule is no longer approved. Review its settings.');
    const { excluded } = await this.check(rule);
    if (
      run.file !== rule.scope.file ||
      run.revision !== rule.scope.fileRevision ||
      Object.keys(run.bindings).length !== Object.keys(rule.scope.bindings).length ||
      Object.entries(run.bindings).some(([name, value]) => value !== rule.scope.bindings[name])
    )
      throw new Error('The watched workflow scope changed. Review the rule again.');
    const needsSelection = run.definition.steps.some(
      (step) =>
        run.steps.find((record) => record.id === step.id)?.status === 'pending' &&
        workflowReferences(step).some((reference) => reference.kind === 'selection'),
    );
    for (const file of run.context.sources) {
      if (
        !within(rule.scope.root, file) ||
        excluded.some((root) => within(root, file)) ||
        (needsSelection && ((await realpath(file)) !== file || !(await lstat(file)).isFile()))
      )
        throw new Error('A changed file moved outside the watched folder or became unavailable.');
    }
    if (!rule.enabled || this.closed) throw new Error('This watch rule was paused.');
  }
  async recipeForRun(run: WorkflowRun, id: string): Promise<ActionRecipe | undefined> {
    if (!run.watch) return;
    await this.authorize(run);
    const recipe = this.dependencies.recipes().find((recipe) => recipe.id === id);
    if (!recipe) throw new Error('The watched rename recipe is unavailable.');
    return structuredClone(recipe);
  }
  private async scan(rule: StoredWatchRule, excluded: readonly string[]) {
    const results: StoredWatchRule['baseline'] = [];
    let visited = 0;
    const walk = async (folder: string, depth: number) => {
      if (depth > 32 || ++visited > 5000)
        throw new Error('The watched tree is too large. Choose a smaller folder.');
      if (excluded.some((root) => within(root, folder))) return;
      await this.dependencies.access([folder]);
      if ((await realpath(folder)) !== folder)
        throw new Error('The watched tree changed while scanning. Enable the rule again.');
      for (const item of await readdir(folder, { withFileTypes: true })) {
        const file = path.join(folder, item.name);
        if (++visited > 5000)
          throw new Error('The watched tree is too large. Choose a smaller folder.');
        if (excluded.some((root) => within(root, file)) || item.isSymbolicLink()) continue;
        if (item.isDirectory()) {
          if (rule.scope.recursive) await walk(file, depth + 1);
          continue;
        }
        if (!item.isFile()) continue;
        const extension = path.extname(item.name).slice(1).toLowerCase();
        if (rule.scope.extensions.length && !rule.scope.extensions.includes(extension)) continue;
        await this.dependencies.access([file]);
        const info = await lstat(file);
        if (!info.isFile() || (await realpath(file)) !== file) continue;
        results.push({ path: file, version: sourceVersion(await entry(file)) });
        if (results.length > 2000)
          throw new Error('Watch at most 2,000 matching files. Narrow the folder or extensions.');
      }
    };
    await walk(rule.scope.root, 0);
    return results.sort((left, right) => left.path.localeCompare(right.path));
  }
  private attach(rule: StoredWatchRule) {
    if (this.closed || this.watches.has(rule.id)) return;
    const owned = {} as OwnedWatch;
    owned.watcher = (this.dependencies.watch ?? watchDirectory)(rule.scope.root, {
      recursive: rule.scope.recursive,
      ignored: (file) => within(this.directory, file) || file === rule.scope.file,
      changed: () => {
        if (this.watches.get(rule.id) === owned) this.schedule(rule);
      },
      failed: (error) => {
        void this.serial(async () => {
          if (this.watches.get(rule.id) === owned) await this.stop(rule, error.message);
        }).catch(() => {});
      },
    });
    this.watches.set(rule.id, owned);
  }
  private schedule(rule: StoredWatchRule, minimum = 1000) {
    const owned = this.watches.get(rule.id);
    if (!owned || owned.timer || !rule.enabled || this.closed) return;
    const delay = minimum;
    owned.timer = setTimeout(() => {
      owned.timer = undefined;
      void this.serial(() => this.reconcile(rule)).catch(() => {});
    }, delay);
    owned.timer.unref?.();
  }
  private async refresh(rule: StoredWatchRule) {
    if (!rule.runID) return;
    const result = await this.dependencies.workflows.request({ kind: 'get', id: rule.runID });
    if (!result || typeof result !== 'object' || Array.isArray(result) || !('status' in result))
      throw new Error(
        'The previous workflow receipt is unavailable. Review the rule before continuing.',
      );
    if (result.status !== rule.runStatus) {
      rule.runStatus = result.status;
      await this.save();
      this.dependencies.changed(publicRule(rule));
    }
    return result;
  }
  private async reconcile(rule: StoredWatchRule) {
    if (!rule.enabled || this.closed || !this.watches.has(rule.id)) return;
    try {
      const { excluded } = await this.check(rule);
      const result = await this.refresh(rule);
      if (result && pending(result.status)) {
        this.schedule(rule, 10000);
        return;
      }
      if (result && ['failed', 'cancelled'].includes(result.status))
        throw new Error(
          'The last run ' + result.status + '. Inspect its results, then enable the rule again.',
        );
      const remaining = (rule.lastStarted ?? 0) + rule.scope.cooldownSeconds * 1000 - this.now();
      if (remaining > 0) {
        this.schedule(rule, remaining);
        return;
      }
      const snapshot = await this.scan(rule, excluded);
      const previous = new Map(rule.baseline.map((file) => [file.path, file.version]));
      // A completed local rename must not trigger itself again. Later user edits still differ.
      for (const step of result?.steps ?? [])
        if (step.status === 'completed')
          for (const output of step.outputs)
            if (within(rule.scope.root, output.path)) previous.set(output.path, output.version);
      const changed = snapshot.filter((file) => {
        const before = previous.get(file.path);
        return !before || !sameSourceVersion(before, file.version);
      });
      if (changed.length > 50)
        throw new Error(
          'More than 50 files changed. Review them manually, then enable this rule again.',
        );
      // Write the consumed baseline before starting. A crash cannot silently replay a mutation proposal.
      rule.baseline = snapshot;
      if (!changed.length) {
        await this.save();
        return;
      }
      rule.lastStarted = this.now();
      rule.starting = true;
      await this.save();
      const started = await this.dependencies.workflows.request({
        kind: 'start',
        file: rule.scope.file,
        revision: rule.scope.fileRevision,
        bindings: rule.scope.bindings,
        context: {
          workspaceID: 'watch-rule',
          paneID: rule.id,
          rootID: rule.id,
          actor: 'user',
          sources: changed.map((file) => file.path),
        },
        watch: { id: rule.id, approval: rule.approval },
      });
      if (
        !started ||
        typeof started !== 'object' ||
        Array.isArray(started) ||
        !('status' in started)
      )
        throw new Error('The workflow could not start. Review the rule before continuing.');
      rule.runID = started.id;
      rule.starting = false;
      rule.runStatus = started.status;
      await this.save();
      this.dependencies.changed(publicRule(rule));
      this.schedule(rule);
    } catch (error) {
      await this.stop(rule, (error as Error).message);
    }
  }
  private async detach(id: string) {
    const owned = this.watches.get(id);
    this.watches.delete(id);
    if (!owned) return;
    clearTimeout(owned.timer);
    await owned.watcher.close();
  }
  private async stop(rule: StoredWatchRule, reason: string) {
    rule.enabled = false;
    rule.reason = reason.slice(0, 2000);
    rule.revision++;
    await this.detach(rule.id);
    await this.save();
    this.dependencies.changed(publicRule(rule));
  }
  async revoke(root: string) {
    // Stop live watchers before joining the queue so a revocation cannot enqueue more work.
    for (const rule of this.rules.values())
      if (
        [rule.scope.root, rule.scope.file, ...Object.values(rule.scope.bindings)].some((file) =>
          within(root, file),
        )
      ) {
        rule.enabled = false;
        await this.detach(rule.id);
      }
    await this.serial(async () => {
      for (const rule of this.rules.values())
        if (
          [rule.scope.root, rule.scope.file, ...Object.values(rule.scope.bindings)].some((file) =>
            within(root, file),
          )
        )
          await this.stop(
            rule,
            'Folder access was revoked. Choose the folder again before enabling this rule.',
          );
    });
  }
  async close() {
    this.closed = true;
    await Promise.all([...this.watches.keys()].map((id) => this.detach(id)));
    await this.controls.catch(() => {});
    await this.store.flush();
  }
}
