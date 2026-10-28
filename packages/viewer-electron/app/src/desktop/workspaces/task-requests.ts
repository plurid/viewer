import type { AgentWorkspaceSnapshot } from '../../domain/agents/requests';
import type {
  AgentTaskSetup,
  AgentTaskResult,
  TaskWorkflowInput,
  TaskWorkflowReply,
} from '../../domain/agents/task-workflow';
import { errorMessage } from '../../domain/errors';
import type { AgentTaskWorkflows } from '../agents/task-workflow';

interface Owner {
  originID: string;
  workspaceID: string;
  state: AgentWorkspaceSnapshot;
}
interface Ports {
  tasks: Pick<AgentTaskWorkflows, 'prepare' | 'authorize' | 'execute' | 'cancel'>;
  person(owner: number): Owner | undefined;
  authorize(file: string): Promise<string>;
  confirm(setup: AgentTaskSetup, owner: number): Promise<boolean>;
}
interface PendingTaskRequest {
  controller: AbortController;
  taskID?: string;
}
/** The person's form and a CLI proposal share the task engine, with independent authority.
 * A renderer cannot grant MCP access or answer the native task confirmation. */
export class TaskRequests {
  private running = new Map<number, PendingTaskRequest>();
  constructor(private readonly ports: Ports) {}
  async create(input: TaskWorkflowInput, owner: number): Promise<TaskWorkflowReply> {
    const original = this.ports.person(owner);
    if (!original) throw new Error('Create a task from a trusted Viewer window.');
    if (this.running.has(owner)) throw new Error('Finish the current task request first.');
    const controller = new AbortController();
    const pending: PendingTaskRequest = { controller };
    this.running.set(owner, pending);
    let setup: AgentTaskSetup | undefined, progress: AgentTaskResult | undefined;
    const current = () => {
      controller.signal.throwIfAborted();
      const record = this.ports.person(owner);
      if (!record || record.originID !== original.originID)
        throw new Error('The task window closed or changed.');
      return record;
    };
    try {
      setup = await this.ports.tasks.prepare(
        { ...input, workspace: input.workspace ?? original.workspaceID },
        {
          owner,
          signal: controller.signal,
          require: async () => {
            current();
          },
          authorize: async (file) => {
            current();
            const result = await this.ports.authorize(file);
            current();
            return result;
          },
          workspaceState: async () => current().state,
        },
      );
      pending.taskID = setup.id;
      current();
      await this.ports.tasks.authorize(setup);
      if (!(await this.ports.confirm(setup, owner))) return { kind: 'cancelled' };
      current();
      const result = await this.ports.tasks.execute(setup, (value) => {
        progress = value;
      });
      return { kind: 'created', result };
    } catch (error) {
      return {
        kind: 'failed',
        error: errorMessage(error),
        ...(progress ? { result: progress } : {}),
      };
    } finally {
      if (setup) this.ports.tasks.cancel(setup.id);
      if (this.running.get(owner) === pending) this.running.delete(owner);
    }
  }
  stopOwner(owner: number): void {
    const pending = this.running.get(owner);
    pending?.controller.abort();
    if (pending?.taskID) this.ports.tasks.cancel(pending.taskID);
  }
  close(): void {
    for (const owner of this.running.keys()) this.stopOwner(owner);
  }
}
