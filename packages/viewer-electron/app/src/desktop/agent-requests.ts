import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type { AgentProposal, ExecutionGrant } from '../domain/agent-requests';
import type { CapturedTarget } from '../domain/automation';
import type { SettingsPatch } from '../domain/services';
import { DocumentStore } from './document-store';
import type { SettingsService } from './settings';
import { entry, absolute } from './filesystem';
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
    private execute: (id: string, target: CapturedTarget) => Promise<void | { taskID: string }>,
    private terminal: {
      read(id: string): { cwd: string; output: string };
      write(id: string, data: string): void;
    },
  ) {
    this.store = new DocumentStore(path.join(directory, 'execution-approvals-v1.json'), (value) =>
      z
        .array(
          z.object({
            id: z.string(),
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
    this.loaded ??= this.store.load().then((grants) => {
      this.grants = grants || [];
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
  ): Promise<void> {
    const task = this.grantQueue
      .catch(() => {})
      .then(async () => {
        await this.load();
        if (allow) {
          root = await fs.realpath(absolute(root));
          if (!(await fs.stat(root)).isDirectory())
            throw new Error('Choose a folder for the grant.');
        } else absolute(root);
        const next = this.grants.filter(
          (grant) =>
            !(
              grant.actionID === actionID &&
              grant.root === root &&
              grant.capability === capability
            ),
        );
        if (allow) {
          if (
            capability === 'execute' &&
            !this.settings
              .snapshot()
              .settings.customActions.some((action) => 'custom.' + action.id === actionID)
          )
            throw new Error('Choose an existing custom action.');
          next.push({
            id: randomUUID(),
            actionID,
            root,
            capability,
            fingerprint: capability === 'execute' ? this.actionFingerprint(actionID) : '',
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
    const value = { ...proposal, id: randomUUID(), status: 'review' as const, fingerprint: hash };
    this.proposals.set(value.id, value);
    this.emit(value);
    return value;
  }
  async command(
    commandID: string,
    target: CapturedTarget,
    title: string,
  ): Promise<{ id: string; requiresUserReview: boolean }> {
    if (
      commandID.startsWith('custom.') &&
      (await this.allowed(commandID, target.directory, 'execute'))
    ) {
      const proposal = this.add(
        {
          kind: 'command',
          title,
          commandID,
          target: structuredClone(target),
          detail: 'Authorized by a saved grant.',
        },
        this.actionFingerprint(commandID),
      );
      await this.review(proposal.id, true);
      return { id: proposal.id, requiresUserReview: false };
    }
    const action = this.settings
      .snapshot()
      .settings.customActions.find((action) => 'custom.' + action.id === commandID);
    const proposal = this.add(
      {
        kind: 'command',
        title,
        commandID,
        target: structuredClone(target),
        detail: action
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
    id: string,
    data: string,
  ): Promise<{ id: string; requiresUserReview: boolean }> {
    const value = this.terminal.read(id);
    if (await this.allowed('*', value.cwd, 'terminal-write')) {
      const proposal = this.add({
        kind: 'terminal-write',
        title: 'Write to terminal',
        terminalID: id,
        data,
        detail: 'Authorized by a saved terminal write grant.',
      });
      await this.review(proposal.id, true);
      return { id: proposal.id, requiresUserReview: false };
    }
    const proposal = this.add({
      kind: 'terminal-write',
      title: 'Write to terminal',
      terminalID: id,
      data,
      detail: `Directory: ${value.cwd}\n\n` + JSON.stringify(data),
    });
    return { id: proposal.id, requiresUserReview: true };
  }
  execution(task: import('../domain/automation').ExecutionTask): void {
    if (task.status === 'running') return;
    for (const proposal of this.proposals.values())
      if (proposal.taskID === task.id) {
        proposal.status = task.status;
        proposal.task = task;
        proposal.error = task.error;
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
      if (proposal.kind === 'configuration')
        await this.settings.patch(proposal.patches!, proposal.revision!);
      else if (proposal.kind === 'terminal-write')
        this.terminal.write(proposal.terminalID!, proposal.data!);
      else {
        if (
          proposal.fingerprint &&
          proposal.fingerprint !== this.actionFingerprint(proposal.commandID!)
        )
          throw new Error('Action configuration changed. Ask the agent for a new proposal.');
        for (const file of proposal.target!.selection)
          if ((await entry(file.path)).identity !== file.identity)
            throw new Error('Selection changed. Ask the agent for a new proposal.');
        const result = await this.execute(proposal.commandID!, proposal.target!);
        if (result?.taskID) proposal.taskID = result.taskID;
      }
      proposal.status = proposal.taskID ? 'running' : 'completed';
    } catch (error) {
      proposal.status = 'failed';
      proposal.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.emit(proposal);
    }
  }
}
