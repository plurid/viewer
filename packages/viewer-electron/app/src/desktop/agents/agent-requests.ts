import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type { AgentNavigation, AgentProposal, ExecutionGrant } from '../../domain/agents/requests';
import type { CapturedTarget, ExecutionTask } from '../../domain/automation/actions';
import type { SettingsPatch } from '../../domain/services';
import { DocumentStore } from '../persistence/document-store';
import type { SettingsService } from '../preferences/settings';
import { entry, absolute } from '../files/filesystem';
import { agentCommandID, agentConfigurationPath } from '../../domain/agents/safety';
import { sameSourceVersion, sourceVersion } from '../../domain/files/inspection';
import type { OperationJob } from '../../domain/contracts';
import { formatBytes } from '../../domain/files/entries';
import { outputProof } from '../operations/operation-journal';
import { errorMessage } from '../../domain/errors';
import { sharedClientID, storedClientID } from '../../domain/agents/clients';
import {
  validateTransform,
  combinedTransform,
  transformDescription,
  transformExtension,
} from '../../domain/operations/transforms';
import type { TransformPlan } from '../../domain/operations/transforms';
import { speechSetupSchema, type SpeechSetup } from '../../domain/speech/models';
import { validName } from '../files/filesystem';
import type { AgentTaskSetup, AgentTaskResult } from '../../domain/agents/task-workflow';
import { taskWorkflowReviewDetail } from '../../domain/agents/task-workflow';
const fingerprint = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex');
const within = (file: string, root: string) =>
  file === root || file.startsWith(root.replace(/\/$/, '') + '/');
/** Counts a folder's contents for review, without following links. */
async function folderContents(root: string): Promise<{ items: number; bytes: number } | null> {
  let items = 0,
    bytes = 0;
  const pending = [root];
  while (pending.length) {
    const file = pending.pop()!;
    const info = await fs.lstat(file);
    if (file !== root) {
      if (++items > 10000) return null;
      if (info.isFile()) bytes += info.size;
    }
    if (info.isDirectory())
      for (const name of await fs.readdir(file)) pending.push(path.join(file, name));
  }
  return { items, bytes };
}
/** Commands and configuration changes can alter files or later execution; navigation cannot. */
export const needsNativeConfirmation = (proposal: AgentProposal) =>
  proposal.kind === 'command' ||
  proposal.kind === 'configuration' ||
  proposal.kind === 'speech' ||
  proposal.kind === 'task-workflow';
/** Effective approvals live outside editable configuration and bind to the exact executor. */
export class AgentRequests {
  private proposals = new Map<string, AgentProposal & { fingerprint?: string }>();
  /** Private content proofs of folders in pending Trash proposals, by proposal ID. */
  private contents = new Map<string, Map<string, string>>();
  private grants: ExecutionGrant[] = [];
  private store: DocumentStore<ExecutionGrant[]>;
  private loaded?: Promise<void>;
  private grantQueue: Promise<void> = Promise.resolve();
  constructor(
    directory: string,
    private settings: SettingsService,
    private emit: (proposal: AgentProposal) => void,
    private execute: (
      id: string,
      target: CapturedTarget,
      /** The approved folders' content proofs, rechecked as a Trash move runs. */
      contents?: ReadonlyMap<string, string>,
    ) => Promise<
      void | { taskID: string; operationID?: never } | { operationID: string; taskID?: never }
    >,
    /** Read-only: no route exists for agent terminal input (AGENTS.md). */
    private terminal: { read(id: string): { cwd: string; output: string } },
    private navigate?: (request: AgentNavigation, target: CapturedTarget) => Promise<void>,
    private authority?: {
      actor(): string;
      check(proposal: AgentProposal): Promise<void>;
      run<T>(clientID: string, work: () => Promise<T>): Promise<T>;
      cancelExecution(id: string): void;
      cancelOperation?(id: string): void;
      operation?(id: string): OperationJob | undefined;
      cancelSpeech?(id: string): void;
      cancelTaskWorkflow?(id: string): void;
    },
    /** A confirmation the desktop process shows itself. A renderer approval alone
     * never runs a command or configuration change (AGENTS.md). */
    private confirm?: (proposal: AgentProposal) => Promise<boolean>,
    private exportTransform?: (proposal: AgentProposal) => Promise<{ operationID: string }>,
    private setupSpeech?: (setup: SpeechSetup, operationID: string) => Promise<unknown>,
    private setupTask?: (
      setup: AgentTaskSetup,
      progress: (result: AgentTaskResult) => void,
    ) => Promise<AgentTaskResult>,
  ) {
    this.store = new DocumentStore(path.join(directory, 'execution-approvals-v1.json'), (value) =>
      z
        .array(
          z.object({
            id: z.string(),
            clientID: storedClientID.optional().default(sharedClientID),
            actionID: z.string(),
            root: z.string(),
            chosen: z.string().optional(),
            fingerprint: z.string(),
            capability: z.enum(['execute', 'terminal-read', 'terminal-write']),
          }),
        )
        .parse(value),
    );
  }
  async load(): Promise<void> {
    this.loaded ??= this.store
      .load()
      .then((grants) => {
        this.grants = grants || [];
      })
      .catch((error: unknown) => {
        // A failed read is retried by the next caller instead of disabling this service.
        this.loaded = undefined;
        throw error;
      });
    await this.loaded;
  }
  async listGrants(): Promise<ExecutionGrant[]> {
    await this.load();
    return this.grants;
  }
  private actionFingerprint(id: string): string {
    return fingerprint(
      this.settings
        .snapshot()
        .settings.customActions.find((action) => 'custom.' + action.id === id),
    );
  }
  async grant(
    actionID: string,
    root: string,
    capability: ExecutionGrant['capability'],
    allow: boolean,
    clientID = sharedClientID,
  ): Promise<void> {
    const task = this.grantQueue
      .catch(() => {})
      .then(async () => {
        await this.load();
        if (allow && capability !== 'terminal-read')
          throw new Error(
            'Agent actions require approval each time. Shell execution and terminal input cannot enforce Trash-only removal.',
          );
        // A grant covers the folder a chosen path resolves to. Revoking by that chosen path, a
        // link or alias included, must remove it too; a folder that is gone resolves to itself.
        const chosen = absolute(root);
        root = allow ? await fs.realpath(chosen) : await fs.realpath(chosen).catch(() => chosen);
        if (allow && !(await fs.stat(root)).isDirectory())
          throw new Error('Choose a folder for the grant.');
        const next = this.grants.filter(
          (grant) =>
            !(
              grant.actionID === actionID &&
              (grant.clientID ?? sharedClientID) === clientID &&
              (grant.root === root || grant.root === chosen || grant.chosen === chosen) &&
              grant.capability === capability
            ),
        );
        if (allow) {
          next.push({
            id: randomUUID(),
            clientID,
            actionID,
            root,
            ...(chosen !== root ? { chosen } : {}),
            capability,
            fingerprint: '',
          });
        }
        await this.store.save(next);
        this.grants = next;
      });
    this.grantQueue = task;
    await task;
  }
  /** Every grant one client holds. A regenerated token starts its connection afresh: the grants
   * were the connection's, so the token given after the old one leaked kept them. */
  async revokeGrants(clientID: string): Promise<void> {
    const task = this.grantQueue
      .catch(() => {})
      .then(async () => {
        await this.load();
        const next = this.grants.filter((grant) => (grant.clientID ?? sharedClientID) !== clientID);
        if (next.length === this.grants.length) return;
        await this.store.save(next);
        this.grants = next;
      });
    this.grantQueue = task;
    await task;
  }
  private async allowed(
    actionID: string,
    root: string,
    capability: ExecutionGrant['capability'],
  ): Promise<boolean> {
    await this.load();
    root = await fs.realpath(absolute(root));
    return this.grants.some(
      (grant) =>
        grant.capability === capability &&
        (grant.clientID ?? sharedClientID) === (this.authority?.actor() ?? sharedClientID) &&
        grant.actionID === actionID &&
        within(root, grant.root) &&
        (capability !== 'execute' || grant.fingerprint === this.actionFingerprint(actionID)),
    );
  }
  list(): AgentProposal[] {
    return [...this.proposals.values()];
  }
  has(id: string): boolean {
    return this.proposals.has(id);
  }
  get(id: string): AgentProposal {
    const value = this.proposals.get(id);
    if (!value) throw new Error('Proposal no longer exists.');
    return value;
  }
  private add(proposal: Omit<AgentProposal, 'id' | 'status'>, hash?: string): AgentProposal {
    if (
      [...this.proposals.values()].filter((proposal) => proposal.status === 'review').length >= 100
    )
      throw new Error('Review pending proposals before submitting another.');
    while (this.proposals.size >= 200) {
      const old = [...this.proposals].find(
        ([, value]) => !['review', 'running'].includes(value.status),
      );
      if (!old) break;
      this.proposals.delete(old[0]);
      this.contents.delete(old[0]);
    }
    const value = {
      ...proposal,
      clientID: this.authority?.actor() ?? sharedClientID,
      id: randomUUID(),
      status: 'review' as const,
      fingerprint: hash,
    };
    this.proposals.set(value.id, value);
    this.emit(value);
    return value;
  }
  speech(setup: SpeechSetup, detail: string): { id: string; requiresUserReview: true } {
    const parsed = speechSetupSchema.parse(setup);
    const proposal = this.add({
      kind: 'speech',
      speech: parsed,
      title:
        parsed.kind === 'use'
          ? 'Choose local speech model'
          : parsed.kind === 'import'
            ? 'Import local speech model'
            : 'Download local speech model',
      detail,
    });
    return { id: proposal.id, requiresUserReview: true };
  }
  taskWorkflow(setup: AgentTaskSetup): { id: string; requiresUserReview: true } {
    const proposal = this.add({
      kind: 'task-workflow',
      taskSetup: structuredClone(setup),
      title: 'Create task from branch',
      detail: taskWorkflowReviewDetail(setup),
    });
    return { id: proposal.id, requiresUserReview: true };
  }
  async command(
    commandID: string,
    target: CapturedTarget,
    title: string,
  ): Promise<{ id: string; requiresUserReview: boolean }> {
    const resolved = agentCommandID(commandID, this.settings.snapshot().settings.customActions);
    const trash = resolved === 'trash';
    if (trash && !target.selection.length)
      throw new Error('Select the exact items to move to Trash.');
    const action = this.settings
      .snapshot()
      .settings.customActions.find((action) => 'custom.' + action.id === commandID);
    // A folder's reviewed contents are pinned, not just the folder entry: anything
    // added, removed or changed inside it afterwards voids the approval.
    const contents = new Map<string, string>();
    const lines: string[] = [];
    for (const file of trash ? target.selection : []) {
      // what the item is, read from the disk: the selection's `directory` came from the window,
      // so a folder sent as a file was listed, and approved, as one path
      const actual = await entry(file.path);
      if (actual.identity !== file.identity)
        throw new Error('Selection changed. Ask the agent for a new proposal.');
      if (!actual.directory) {
        lines.push(file.path);
        continue;
      }
      const [summary, proof] = await Promise.all([
        folderContents(file.path),
        outputProof(file.path),
      ]);
      if (!summary || !proof)
        throw new Error(
          `${file.name} holds more than 10,000 items. Move it to the Trash yourself after reviewing it.`,
        );
      contents.set(file.path, proof);
      lines.push(
        `${file.path}  (folder: ${summary.items} ${summary.items === 1 ? 'item' : 'items'}, ${formatBytes(summary.bytes)})`,
      );
    }
    const proposal = this.add(
      {
        kind: 'command',
        title: trash ? 'Move to Trash' : title,
        commandID,
        ...(trash ? { removal: 'trash' as const } : {}),
        target: structuredClone(target),
        detail: trash
          ? 'Move only these items to the system Trash:\n\n' +
            lines.join('\n') +
            '\n\nSelected folders include the contents counted above; any change to them cancels this approval. Nothing is permanently deleted. This approval applies only to this request.'
          : action
            ? JSON.stringify(action.executor, null, 2)
            : `Run ${title} for the captured selection.`,
      },
      action ? this.actionFingerprint(commandID) : undefined,
    );
    if (contents.size) this.contents.set(proposal.id, contents);
    return { id: proposal.id, requiresUserReview: true };
  }
  configuration(
    patches: SettingsPatch[],
    target?: CapturedTarget,
  ): { id: string; requiresUserReview: true } {
    for (const patch of patches) agentConfigurationPath(patch.keys ?? patch.path.split('.'));
    this.settings.preview(patches);
    const proposal = this.add({
      kind: 'configuration',
      target: target && structuredClone(target),
      title: 'Update configuration',
      patches,
      revision: this.settings.snapshot().revision,
      detail: JSON.stringify(patches, null, 2),
    });
    return { id: proposal.id, requiresUserReview: true };
  }
  transform(
    plan: TransformPlan,
    destination: string,
    name: string,
    target: CapturedTarget,
  ): { id: string; requiresUserReview: true } {
    if (!this.exportTransform) throw new Error('Transform proposals are unavailable.');
    plan = validateTransform(plan, target.selection.length);
    absolute(destination);
    validName(name);
    if (!name.toLowerCase().endsWith('.' + transformExtension(plan.format)))
      throw new Error('Choose an output filename matching the transform format.');
    if (!combinedTransform(plan) && target.selection.length !== 1)
      throw new Error('Propose one image export at a time, or use a reviewed conversion workflow.');
    if (target.selection.some((file) => file.kind !== 'file'))
      throw new Error('Choose regular source files.');
    const proposal = this.add({
      kind: 'transform',
      title: 'Export ' + name,
      target: structuredClone(target),
      transform: { plan: structuredClone(plan), destination, name },
      detail:
        target.selection.map((file) => file.path).join('\n') +
        '\n\n' +
        transformDescription(plan) +
        '\n\nSave in ' +
        destination +
        '\nCreates a new file. Existing files are kept.',
    });
    return { id: proposal.id, requiresUserReview: true };
  }
  navigation(
    request: AgentNavigation,
    target: CapturedTarget,
  ): { id: string; requiresUserReview: true } {
    if (!this.navigate) throw new Error('Workspace navigation is unavailable.');
    const title =
      request.kind === 'open-path'
        ? 'Open path'
        : request.kind === 'select-files'
          ? 'Select files'
          : request.kind === 'focus-plane'
            ? 'Focus plane'
            : 'Change workspace';
    const proposal = this.add({
      kind: 'navigation',
      title,
      target: structuredClone(target),
      navigation: structuredClone(request),
      detail:
        request.kind === 'open-path'
          ? `${request.path}\n\n${{ current: 'Use the current folder plane; files open in a linked preview.', root: 'Open an independent root plane.', linked: 'Open a linked plane.' }[request.placement]}`
          : request.kind === 'select-files'
            ? request.files.length
              ? request.files.map((file) => file.path).join('\n')
              : 'Clear selection in the captured folder.'
            : request.kind === 'focus-plane'
              ? request.pane.path
              : `${request.workspace.name}\n\n${request.workspace.panes.map((pane) => pane.path).join('\n') || 'Empty workspace'}`,
    });
    return { id: proposal.id, requiresUserReview: true };
  }
  terminalDirectory(id: string): string {
    return this.terminal.read(id).cwd;
  }
  async readTerminal(id: string): Promise<{ cwd: string; output: string }> {
    const value = this.terminal.read(id);
    if (!(await this.allowed('*', value.cwd, 'terminal-read')))
      throw new Error('Terminal output needs a separate read grant in Settings → Agents.');
    return value;
  }
  async writeTerminal(
    _id: string,
    _data: string,
  ): Promise<{ id: string; requiresUserReview: boolean }> {
    throw new Error('Agent terminal input is unavailable because it can permanently delete files.');
  }
  execution(task: ExecutionTask): void {
    if (task.status === 'running') return;
    for (const proposal of this.proposals.values())
      if (proposal.taskID === task.id) {
        proposal.status = task.status;
        proposal.task = task;
        proposal.error = task.error;
        this.emit(proposal);
      }
  }
  operation(job: OperationJob): void {
    for (const proposal of this.proposals.values()) {
      if (proposal.operationID !== job.id || proposal.status === 'cancelled') continue;
      proposal.operation = structuredClone(job);
      if (['completed', 'failed', 'cancelled'].includes(job.status)) {
        proposal.status = job.status as 'completed' | 'failed' | 'cancelled';
        proposal.error = job.errors.length
          ? job.errors.map((error) => error.message).join('\n')
          : undefined;
      }
      this.emit(proposal);
    }
  }
  async review(id: string, approve: boolean): Promise<void> {
    const proposal = this.proposals.get(id);
    if (!proposal || proposal.status !== 'review')
      throw new Error('Proposal no longer needs review.');
    if (!approve) {
      if (proposal.taskSetup) this.authority?.cancelTaskWorkflow?.(proposal.taskSetup.id);
      proposal.status = 'rejected';
      this.emit(proposal);
      return;
    }
    if (needsNativeConfirmation(proposal)) {
      if (!this.confirm) throw new Error('Native confirmation is unavailable, so nothing was run.');
      // Hold the proposal while the dialog is open so a second approval cannot race it.
      proposal.status = 'running';
      this.emit(proposal);
      let confirmed = false;
      try {
        confirmed = await this.confirm(structuredClone(proposal));
      } finally {
        if (!confirmed && this.proposals.get(id) === proposal && proposal.status === 'running') {
          proposal.status = 'review';
          this.emit(proposal);
        }
      }
      if (!confirmed) throw new Error('The request was not confirmed. Nothing was run.');
      if (this.proposals.get(id) !== proposal || proposal.status !== 'running')
        throw new Error('This agent task was stopped.');
    }
    proposal.status = 'running';
    this.emit(proposal);
    try {
      await this.authority?.check(proposal);
      const execute = async () => {
        if (this.proposals.get(id)?.status !== 'running')
          throw new Error('This agent task was stopped.');
        if (proposal.kind === 'task-workflow') {
          if (!proposal.taskSetup || !this.setupTask)
            throw new Error('Task creation is unavailable.');
          proposal.taskResult = await this.setupTask(proposal.taskSetup, (result) => {
            proposal.taskResult = result;
            this.emit(proposal);
          });
        } else if (proposal.kind === 'speech') {
          if (!proposal.speech || !this.setupSpeech)
            throw new Error('Speech model setup is unavailable.');
          await this.setupSpeech(speechSetupSchema.parse(proposal.speech), proposal.id);
        } else if (proposal.kind === 'configuration') {
          for (const patch of proposal.patches!)
            agentConfigurationPath(patch.keys ?? patch.path.split('.'));
          // checked again as it applies: what it names may have gone since it was proposed
          this.settings.preview(proposal.patches!);
          await this.settings.patch(proposal.patches!, proposal.revision!);
        } else if (proposal.kind === 'terminal-write')
          throw new Error(
            'Agent terminal input is unavailable because it can permanently delete files.',
          );
        else if (proposal.kind === 'navigation') {
          if (!this.navigate) throw new Error('Workspace navigation is unavailable.');
          await this.navigate(proposal.navigation!, proposal.target!);
        } else if (proposal.kind === 'transform') {
          if (!this.exportTransform || !proposal.transform || !proposal.target)
            throw new Error('This transformation is unavailable.');
          validateTransform(proposal.transform.plan, proposal.target.selection.length);
          for (const source of proposal.target.selection)
            if (!sameSourceVersion(sourceVersion(source), sourceVersion(await entry(source.path))))
              throw new Error('A source changed after this proposal. Request a new export.');
          await this.authority?.check(proposal);
          const result = await this.exportTransform(proposal);
          proposal.operationID = result.operationID;
          const current = this.authority?.operation?.(result.operationID);
          if (current) this.operation(current);
          if (this.proposals.get(id)?.status === 'cancelled')
            this.authority?.cancelOperation?.(result.operationID);
        } else {
          const resolved = agentCommandID(
            proposal.commandID!,
            this.settings.snapshot().settings.customActions,
          );
          if (
            proposal.fingerprint &&
            proposal.fingerprint !== this.actionFingerprint(proposal.commandID!)
          )
            throw new Error('Action configuration changed. Ask the agent for a new proposal.');
          for (const file of proposal.target!.selection) {
            const current = await entry(file.path);
            if (
              current.identity !== file.identity ||
              (resolved === 'trash' &&
                !sameSourceVersion(sourceVersion(current), sourceVersion(file)))
            )
              throw new Error('Selection changed. Ask the agent for a new proposal.');
          }
          for (const [folder, proof] of this.contents.get(id) ?? [])
            if ((await outputProof(folder)) !== proof)
              throw new Error(
                `The contents of ${folder} changed after the request. Ask the agent for a new proposal.`,
              );
          await this.authority?.check(proposal);
          if (this.proposals.get(id)?.status !== 'running')
            throw new Error('This agent task was stopped.');
          const result = await this.execute(
            proposal.commandID!,
            proposal.target!,
            this.contents.get(id),
          );
          if (result?.taskID) proposal.taskID = result.taskID;
          if (result?.operationID) {
            proposal.operationID = result.operationID;
            const current = this.authority?.operation?.(result.operationID);
            if (current) this.operation(current);
          }
          if (this.proposals.get(id)?.status === 'cancelled' && proposal.taskID)
            this.authority?.cancelExecution(proposal.taskID);
          if (this.proposals.get(id)?.status === 'cancelled' && proposal.operationID)
            this.authority?.cancelOperation?.(proposal.operationID);
        }
      };
      if (this.authority) await this.authority.run(proposal.clientID ?? sharedClientID, execute);
      else await execute();
      if (this.proposals.get(id)?.status !== 'cancelled' && !proposal.operationID)
        proposal.status = proposal.taskID ? 'running' : 'completed';
    } catch (error) {
      if (this.proposals.get(id)?.status !== 'cancelled') proposal.status = 'failed';
      proposal.error = errorMessage(error);
      throw error;
    } finally {
      this.emit(proposal);
    }
  }
  stop(clientID: string): void {
    const failures: unknown[] = [];
    for (const proposal of this.proposals.values()) {
      if (
        (proposal.clientID ?? sharedClientID) !== clientID ||
        !['review', 'running'].includes(proposal.status)
      )
        continue;
      try {
        this.cancel(proposal.id, clientID);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(failures, 'Some proposal owners could not be stopped.');
  }
  cancel(id: string, clientID: string): void {
    const proposal = this.get(id);
    if ((proposal.clientID ?? sharedClientID) !== clientID)
      throw new Error('Proposal belongs to another actor.');
    if (!['review', 'running'].includes(proposal.status)) return;
    // Retire admission before calling owners: one failed cancellation must not leave
    // this proposal executable or prevent other independent owners from stopping.
    proposal.status = 'cancelled';
    const cancellations = [
      () => {
        if (proposal.taskID) this.authority?.cancelExecution(proposal.taskID);
      },
      () => {
        if (proposal.kind === 'speech') this.authority?.cancelSpeech?.(proposal.id);
      },
      () => {
        if (proposal.taskSetup) this.authority?.cancelTaskWorkflow?.(proposal.taskSetup.id);
      },
      () => {
        if (proposal.operationID) this.authority?.cancelOperation?.(proposal.operationID);
      },
    ];
    const failures: unknown[] = [];
    for (const cancel of cancellations)
      try {
        cancel();
      } catch (error) {
        failures.push(error);
      }
    this.emit(proposal);
    if (failures.length)
      throw new AggregateError(failures, 'Some proposal owners could not be stopped.');
  }
}
