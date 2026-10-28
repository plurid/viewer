import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { CapturedTarget } from '../../domain/automation/actions';
import type { AgentCapability } from '../../domain/agents/clients';
import type { AgentWorkspaceSnapshot, CommandDescriptor } from '../../domain/agents/requests';
import { agentCommandID } from '../../domain/agents/safety';
import { workflowRunSchema, type WorkflowRun } from '../../domain/automation/workflows';
import { resolveProjectPath } from '../../domain/workspaces/project';
import type { ApplicationSettings } from '../../domain/services';
import type { SpeechSetup } from '../../domain/speech/models';
import type { GitReader } from '../comparison/git';
import type { Workflows } from '../automation/workflows';
import type { SpeechModels } from '../speech/models';
import type { AgentRequests } from './agent-requests';
import { answerPrompt } from '../models/prompts';
import { taskWorkflowInputSchema, selectAgentWorkspace } from '../../domain/agents/task-workflow';
import type { AgentTaskWorkflows } from './task-workflow';

export interface AgentServiceContext {
  clientID: string;
  signal: AbortSignal;
  authorize(file: string): Promise<string>;
  require(capability: AgentCapability): Promise<void>;
  catalog(): { target: CapturedTarget; commands: CommandDescriptor[] } | undefined;
  workspaceState(): Promise<AgentWorkspaceSnapshot | undefined>;
  own(id: string): void;
}
interface Dependencies {
  git: Pick<GitReader, 'root' | 'status' | 'diff'>;
  workflows: Pick<Workflows, 'request'>;
  speech: Pick<SpeechModels, 'status' | 'describe'>;
  proposals: Pick<AgentRequests, 'speech'> & Partial<Pick<AgentRequests, 'taskWorkflow'>>;
  tasks?: Pick<AgentTaskWorkflows, 'prepare' | 'authorize'>;
  settings(): ApplicationSettings;
  generate: Parameters<typeof answerPrompt>[2];
}
const local = z
  .string()
  .min(1)
  .max(32768)
  .refine((value) => path.isAbsolute(value) && !value.includes('\0'));
const id = z.string().min(1).max(200);
const empty = z.object({}).strict();

/** Existing feature owners execute the work; this adapter only binds client scopes and ownership. */
export class AgentServiceTools {
  constructor(private ports: Dependencies) {}
  async authorizeWorkflow(run: WorkflowRun, context: AgentServiceContext): Promise<void> {
    if (run.context.actor !== 'agent' || run.context.clientID !== context.clientID)
      throw new Error('This workflow belongs to another actor.');
    await context.require('propose');
    await context.require('content');
    await context.authorize(run.file);
    for (const file of [...run.context.sources, ...Object.values(run.bindings)])
      await context.authorize(file);
    for (const input of Object.values(run.definition.inputs)) {
      const resolved = resolveProjectPath(path.dirname(run.file), input, run.bindings);
      if (!resolved) throw new Error('Complete the workflow bindings before starting.');
      await context.authorize(resolved);
    }
    for (const step of run.steps)
      for (const file of [...step.sources, ...step.outputs]) await context.authorize(file.path);
  }
  async stop(clientID: string): Promise<void> {
    const runs = await this.ports.workflows.request({ kind: 'list' });
    if (!Array.isArray(runs)) return;
    for (const run of runs)
      if (
        run.context.actor === 'agent' &&
        run.context.clientID === clientID &&
        ['running', 'paused', 'waiting-review'].includes(run.status)
      )
        await this.ports.workflows.request({ kind: 'cancel', id: run.id });
  }
  async call(
    name: string,
    args: Record<string, unknown>,
    context: AgentServiceContext,
  ): Promise<unknown> {
    context.signal.throwIfAborted();
    if (name === 'git_status' || name === 'git_diff') return this.readGit(name, args, context);
    if (name === 'list_task_areas') return this.taskAreas(args, context);
    if (name === 'propose_task_create') {
      if (!this.ports.tasks || !this.ports.proposals.taskWorkflow)
        throw new Error('Task creation is unavailable.');
      const setup = await this.ports.tasks.prepare(taskWorkflowInputSchema.parse(args), context);
      context.signal.throwIfAborted();
      const result = this.ports.proposals.taskWorkflow(setup);
      context.own(result.id);
      return {
        ...result,
        workspaceID: setup.workspaceID,
        taskID: setup.id,
        path: setup.destination,
        branch: setup.branch,
        commit: setup.commit,
      };
    }
    if (name === 'speech_models' || name === 'speech_status') return this.speechStatus(args);
    if (['propose_speech_install', 'propose_speech_import', 'propose_speech_use'].includes(name))
      return this.proposeSpeech(name, args, context);
    if (name === 'ask_in_words') return this.ask(args, context);
    if (name === 'read_workflow' || name === 'run_workflow')
      return this.startWorkflow(name, args, context);
    if (name === 'list_workflows') return this.listWorkflows(args, context);
    if (['get_workflow', 'resume_workflow', 'cancel_workflow'].includes(name))
      return this.workflowRequest(name, args, context);
    throw new Error('Unknown service tool.');
  }
  private async readGit(name: string, args: Record<string, unknown>, context: AgentServiceContext) {
    const input = z
      .object({
        path: local,
        ...(name === 'git_diff' ? { base: z.string().min(1).max(300).default('HEAD') } : {}),
      })
      .strict()
      .parse(args);
    await context.authorize(input.path);
    const root = await this.ports.git.root(input.path);
    await context.authorize(root);
    if (name === 'git_status') {
      const status = await this.ports.git.status(root, true);
      if (status.kind !== 'ready') throw new Error(status.message);
      await context.authorize(status.snapshot.root);
      return status;
    }
    await context.require('content');
    const result = await this.ports.git.diff(root, String(input.base), context.signal);
    await context.authorize(result.root);
    return result;
  }
  private async taskAreas(args: Record<string, unknown>, context: AgentServiceContext) {
    const input = z
      .object({ workspace: z.string().trim().min(1).max(200).optional() })
      .strict()
      .parse(args);
    const state = await context.workspaceState();
    const workspaces = input.workspace
      ? [selectAgentWorkspace(state, input.workspace)]
      : (state?.workspaces ?? []);
    const result = [];
    for (const workspace of workspaces)
      for (const task of workspace.tasks ?? []) {
        try {
          await context.authorize(task.path);
          result.push({ ...task, workspaceID: workspace.id });
        } catch {
          /* A task name is private when its checkout is outside this client's folders. */
        }
      }
    return result;
  }
  private speechStatus(args: Record<string, unknown>) {
    empty.parse(args);
    return this.ports.speech.status();
  }
  private async proposeSpeech(
    name: string,
    args: Record<string, unknown>,
    context: AgentServiceContext,
  ) {
    const input = z
      .object({ model: id, ...(name === 'propose_speech_import' ? { source: local } : {}) })
      .strict()
      .parse(args);
    await context.require('propose');
    if (typeof input.source === 'string') {
      await context.require('content');
      await context.authorize(input.source);
    }
    const setup: SpeechSetup =
      name === 'propose_speech_import'
        ? { kind: 'import', model: input.model, source: String(input.source) }
        : { kind: name === 'propose_speech_use' ? 'use' : 'install', model: input.model };
    const detail = await this.ports.speech.describe(setup);
    context.signal.throwIfAborted();
    const result = this.ports.proposals.speech(setup, detail);
    context.own(result.id);
    return result;
  }
  private async ask(args: Record<string, unknown>, context: AgentServiceContext) {
    const { prompt } = z
      .object({ prompt: z.string().min(1).max(12000) })
      .strict()
      .parse(args);
    await context.require('propose');
    const catalog = context.catalog();
    if (!catalog) throw new Error('Focus a granted folder in Viewer before asking for a command.');
    await context.authorize(catalog.target.directory);
    for (const file of catalog.target.selection) await context.authorize(file.path);
    const settings = this.ports.settings(),
      state = await context.workspaceState();
    const commands = catalog.commands.filter((command) => {
      try {
        agentCommandID(command.id, settings.customActions);
        return true;
      } catch {
        return false;
      }
    });
    return answerPrompt(
      {
        id: randomUUID(),
        prompt,
        context: {
          folder: catalog.target.directory,
          selection: catalog.target.selection.slice(0, 50).map((file) => file.name),
          workspace:
            state?.workspaces.find((workspace) => workspace.id === catalog.target.workspaceID)
              ?.name ?? '',
          workspaces: [],
          commands,
          userCommands: [],
        },
      },
      settings,
      this.ports.generate,
      context.signal,
      new Map(),
      'agent',
    );
  }
  private async startWorkflow(
    name: string,
    args: Record<string, unknown>,
    context: AgentServiceContext,
  ) {
    const input = z
      .object({
        file: local,
        ...(name === 'run_workflow'
          ? { bindings: z.record(z.string().min(1).max(100), local).default({}) }
          : {}),
      })
      .strict()
      .parse(args);
    await context.require('content');
    await context.authorize(input.file);
    const document = await this.ports.workflows.request({ kind: 'read', file: input.file });
    if (
      !document ||
      typeof document !== 'object' ||
      Array.isArray(document) ||
      !('definition' in document) ||
      !('revision' in document)
    )
      throw new Error('The workflow definition is unavailable.');
    await context.authorize(document.file);
    if (name === 'read_workflow') return document;
    await context.require('propose');
    const bindings = (input.bindings ?? {}) as Record<string, string>;
    const target = context.catalog()?.target;
    if (!target) throw new Error('Focus a granted folder in Viewer before starting a workflow.');
    await context.authorize(target.directory);
    for (const source of target.selection) await context.authorize(source.path);
    context.signal.throwIfAborted();
    const run = workflowRunSchema.parse(
      await this.ports.workflows.request({
        kind: 'start',
        file: document.file,
        revision: document.revision,
        bindings,
        context: {
          workspaceID: target.workspaceID,
          rootID: target.rootID,
          paneID: target.paneID,
          sources: target.selection.map((file) => file.path),
          actor: 'agent',
          clientID: context.clientID,
        },
      }),
    );
    return { id: run.id, status: run.status };
  }
  private async listWorkflows(args: Record<string, unknown>, context: AgentServiceContext) {
    empty.parse(args);
    await context.require('content');
    const runs = await this.ports.workflows.request({ kind: 'list' });
    if (!Array.isArray(runs)) throw new Error('Workflow history is unavailable.');
    const visible: WorkflowRun[] = [];
    for (const run of runs) {
      if (run.context.actor !== 'agent' || run.context.clientID !== context.clientID) continue;
      try {
        await this.authorizeWorkflow(run, context);
        visible.push(run);
      } catch {
        /* A revoked run is not a source of private history. */
      }
    }
    return visible;
  }
  private async workflowRequest(
    name: string,
    args: Record<string, unknown>,
    context: AgentServiceContext,
  ) {
    const input = z.object({ id }).strict().parse(args);
    const run = workflowRunSchema.parse(
      await this.ports.workflows.request({ kind: 'get', id: input.id }),
    );
    if (run.context.actor !== 'agent' || run.context.clientID !== context.clientID)
      throw new Error('This workflow belongs to another actor.');
    if (name === 'cancel_workflow') return this.workflowControl('cancel', input.id);
    await this.authorizeWorkflow(run, context);
    context.signal.throwIfAborted();
    return name === 'get_workflow' ? run : this.workflowControl('resume', input.id);
  }
  private async workflowControl(kind: 'cancel' | 'resume', id: string) {
    const run = workflowRunSchema.parse(await this.ports.workflows.request({ kind, id }));
    return { id: run.id, status: run.status };
  }
}
