import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type { AgentNavigation, AgentProposal, ExecutionGrant } from '../domain/agent-requests';
import type { CapturedTarget, ExecutionTask } from '../domain/automation';
import type { SettingsPatch } from '../domain/services';
import { DocumentStore } from './document-store';
import type { SettingsService } from './settings';
import { entry, absolute } from './filesystem';
import { agentCommandID } from '../domain/agent-safety';
import { sameSourceVersion, sourceVersion } from '../domain/inspection';
import type { OperationJob } from '../domain/contracts';
const fingerprint = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex');
const within = (file: string, root: string) =>
  file === root || file.startsWith(root.replace(/\/$/, '') + '/');
/** Effective approvals live outside editable configuration and bind to the exact executor. */
export class AgentRequests {
  private proposals = new Map<string, AgentProposal & { fingerprint?: string }>();
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
    ) => Promise<
      void | { taskID: string; operationID?: never } | { operationID: string; taskID?: never }
    >,
    private terminal: {
      read(id: string): { cwd: string; output: string };
      write(id: string, data: string): void;
    },
    private navigate?: (request: AgentNavigation, target: CapturedTarget) => Promise<void>,
    private authority?: {
      actor(): string;
      check(proposal: AgentProposal): Promise<void>;
      run<T>(clientID: string, work: () => Promise<T>): Promise<T>;
      executeAllowed(): Promise<boolean>;
      cancelExecution(id: string): void;
      cancelOperation?(id: string): void;
      operation?(id: string): OperationJob | undefined;
    },
  ) {
    this.store = new DocumentStore(path.join(directory, 'execution-approvals-v1.json'), (value) =>
      z
        .array(
          z.object({
            id: z.string(),
            clientID: z.string().optional().default('legacy'),
            actionID: z.string(),
            root: z.string(),
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
    clientID = 'legacy',
  ): Promise<void> {
    const task = this.grantQueue
      .catch(() => {})
      .then(async () => {
        await this.load();
        if (allow && capability !== 'terminal-read')
          throw new Error(
            'Agent actions require approval each time. Shell execution and terminal input cannot enforce Trash-only removal.',
          );
        if (allow) {
          root = await fs.realpath(absolute(root));
          if (!(await fs.stat(root)).isDirectory())
            throw new Error('Choose a folder for the grant.');
        } else absolute(root);
        const next = this.grants.filter(
          (grant) =>
            !(
              grant.actionID === actionID &&
              (grant.clientID ?? 'legacy') === clientID &&
              grant.root === root &&
              grant.capability === capability
            ),
        );
        if (allow) {
          next.push({
            id: randomUUID(),
            clientID,
            actionID,
            root,
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
        (grant.clientID ?? 'legacy') === (this.authority?.actor() ?? 'legacy') &&
        grant.actionID === actionID &&
        within(root, grant.root) &&
        (capability !== 'execute' || grant.fingerprint === this.actionFingerprint(actionID)),
    );
  }
  list(): AgentProposal[] {
    return [...this.proposals.values()];
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
    }
    const value = {
      ...proposal,
      clientID: this.authority?.actor() ?? 'legacy',
      id: randomUUID(),
      status: 'review' as const,
      fingerprint: hash,
    };
    this.proposals.set(value.id, value);
    this.emit(value);
    return value;
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
    const proposal = this.add(
      {
        kind: 'command',
        title: trash ? 'Move to Trash' : title,
        commandID,
        ...(trash ? { removal: 'trash' as const } : {}),
        target: structuredClone(target),
        detail: trash
          ? 'Move only these items to the system Trash:\n\n' +
            target.selection.map((file) => file.path).join('\n') +
            '\n\nSelected folders include their contents. Nothing is permanently deleted. This approval applies only to this request.'
          : action
            ? JSON.stringify(action.executor, null, 2)
            : `Run ${title} for the captured selection.`,
      },
      action ? this.actionFingerprint(commandID) : undefined,
    );
    return { id: proposal.id, requiresUserReview: true };
  }
  configuration(patches: SettingsPatch[]): { id: string; requiresUserReview: true } {
    this.settings.preview(patches);
    const proposal = this.add({
      kind: 'configuration',
      title: 'Update configuration',
      patches,
      revision: this.settings.snapshot().revision,
      detail: JSON.stringify(patches, null, 2),
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
      proposal.status = 'rejected';
      this.emit(proposal);
      return;
    }
    proposal.status = 'running';
    this.emit(proposal);
    try {
      await this.authority?.check(proposal);
      const execute = async () => {
        if (this.proposals.get(id)?.status !== 'running')
          throw new Error('This agent task was stopped.');
        if (proposal.kind === 'configuration')
          await this.settings.patch(proposal.patches!, proposal.revision!);
        else if (proposal.kind === 'terminal-write')
          throw new Error(
            'Agent terminal input is unavailable because it can permanently delete files.',
          );
        else if (proposal.kind === 'navigation') {
          if (!this.navigate) throw new Error('Workspace navigation is unavailable.');
          await this.navigate(proposal.navigation!, proposal.target!);
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
          await this.authority?.check(proposal);
          if (this.proposals.get(id)?.status !== 'running')
            throw new Error('This agent task was stopped.');
          const result = await this.execute(proposal.commandID!, proposal.target!);
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
      if (this.authority) await this.authority.run(proposal.clientID ?? 'legacy', execute);
      else await execute();
      if (this.proposals.get(id)?.status !== 'cancelled' && !proposal.operationID)
        proposal.status = proposal.taskID ? 'running' : 'completed';
    } catch (error) {
      if (this.proposals.get(id)?.status !== 'cancelled') proposal.status = 'failed';
      proposal.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.emit(proposal);
    }
  }
  stop(clientID: string): void {
    for (const proposal of this.proposals.values()) {
      if (
        (proposal.clientID ?? 'legacy') !== clientID ||
        !['review', 'running'].includes(proposal.status)
      )
        continue;
      if (proposal.taskID) this.authority?.cancelExecution(proposal.taskID);
      if (proposal.operationID) this.authority?.cancelOperation?.(proposal.operationID);
      proposal.status = 'cancelled';
      this.emit(proposal);
    }
  }
}
