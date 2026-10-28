import path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { FileEntry } from '../../domain/contracts';
import type { CapturedTarget } from '../../domain/automation/actions';
import type { AgentWorkspaceSnapshot } from '../../domain/agents/requests';
import type {
  AgentTaskSetup,
  AgentTaskResult,
  AgentTaskBundle,
  TaskWorkflowInput,
} from '../../domain/agents/task-workflow';
import { selectAgentWorkspace, taskWorkflowInputSchema } from '../../domain/agents/task-workflow';
import type { NoteDocument } from '../../domain/editing/notes';
import type { GitRunner } from '../comparison/git';
import { GitWorktrees } from '../comparison/worktrees';
import { addAgentWorktree, assertAgentCheckoutSafe } from '../comparison/agent-worktree';
import type { AgentServiceContext } from './service-tools';

interface Ports {
  available(): boolean;
  authorize(file: string): Promise<unknown>;
  workspaceState(): AgentWorkspaceSnapshot | undefined;
  window(workspaceID: string): { id: number; originID: string } | undefined;
  note(directory: string): Promise<NoteDocument>;
  present(bundle: AgentTaskBundle, owner: number): Promise<void>;
  flush?(owner: number): Promise<void>;
  profile(): string;
  run?: GitRunner;
}
interface Lease {
  setup: AgentTaskSetup;
  owner: number;
  originID: string;
  issued: number;
}

/** A reviewed task uses the same fixed Git writer as the human worktree dialog.
 * A private lease binds its repository revision, workspace window and parameters. */
export class AgentTaskWorkflows {
  private leases = new Map<string, Lease>();
  private running = new Map<string, AbortController>();
  private readonly worktrees: GitWorktrees;
  constructor(private readonly ports: Ports) {
    this.worktrees = new GitWorktrees({
      available: ports.available,
      access: async (paths) => {
        for (const file of paths) await this.authorizePath(file);
      },
      owner: (owner) => {
        for (const lease of this.leases.values())
          if (
            lease.owner === owner &&
            ports.window(lease.setup.workspaceID)?.originID === lease.originID
          )
            return lease.originID;
      },
      validateTarget: async (owner, target) => {
        const lease = [...this.leases.values()].find(
          (item) =>
            item.owner === owner &&
            item.setup.id === target.paneID &&
            item.setup.repo === target.directory,
        );
        if (!lease) throw new Error('The reviewed task expired. Request a new task.');
        await this.authorize(lease.setup);
      },
      run: ports.run,
      create: addAgentWorktree,
    });
  }
  async prepare(raw: TaskWorkflowInput, context: AgentServiceContext): Promise<AgentTaskSetup> {
    if (!this.ports.available())
      throw new Error('CLI task creation is available in the direct build only.');
    const input = taskWorkflowInputSchema.parse(raw);
    await context.require('propose');
    await context.require('navigation');
    const workspace = selectAgentWorkspace(await context.workspaceState(), input.workspace);
    const window = this.ports.window(workspace.id);
    if (!window) throw new Error('Open the selected workspace in Viewer first.');
    await context.authorize(input.repo);
    await context.authorize(path.dirname(input.path));
    const repo = await realpath(input.repo),
      parent = path.dirname(input.path);
    if ((await lstat(input.repo)).isSymbolicLink() || (await lstat(parent)).isSymbolicLink())
      throw new Error('Choose an ordinary repository and destination parent.');
    const destination = path.join(await realpath(parent), path.basename(input.path));
    await assertAgentCheckoutSafe(repo, context.signal);
    try {
      await lstat(destination);
      throw new Error('The destination already exists. Choose a new folder name.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    for (const [id, lease] of this.leases)
      if (!this.running.has(id) && Date.now() - lease.issued > 5 * 60_000) this.leases.delete(id);
    if (this.leases.size >= 100)
      throw new Error('Review pending task requests before creating another.');
    const setup: AgentTaskSetup = {
      id: randomUUID(),
      name: input.name,
      workspaceID: workspace.id,
      workspaceName: workspace.name,
      repo,
      destination,
      branch: input.branch,
      commit: '',
      catalogID: '',
      checkout: { kind: 'new', name: input.branch, baseID: '' },
    };
    const lease: Lease = { setup, owner: window.id, originID: window.originID, issued: Date.now() };
    this.leases.set(setup.id, lease);
    try {
      await this.authorize(setup);
      const reply = await this.worktrees.request(
        { kind: 'list', directory: repo },
        window.id,
        context.signal,
      );
      if (reply.kind !== 'catalog') throw new Error('The worktree catalog is unavailable.');
      const catalog = reply.catalog;
      const branches = catalog.branches ?? [];
      if (catalog.creationProblem) throw new Error(catalog.creationProblem);
      const selected = input.existing
        ? branches.find((branch) => branch.branch === input.branch)
        : !input.base || input.base === 'HEAD'
          ? branches.find((branch) => branch.id === catalog.defaultBaseID)
          : branches.find((branch) => branch.branch === input.base);
      if (!selected) throw new Error('Choose HEAD or an existing local base branch.');
      if (input.existing && selected.worktreeID)
        throw new Error('That branch already has a worktree. Open it instead.');
      if (!input.existing && branches.some((branch) => branch.branch === input.branch))
        throw new Error('That branch exists. Use --existing or choose a new name.');
      setup.catalogID = catalog.id;
      setup.commit = selected.commit;
      setup.checkout = input.existing
        ? { kind: 'existing', branchID: selected.id }
        : { kind: 'new', name: input.branch, baseID: selected.id };
      context.signal.throwIfAborted();
      await this.authorize(setup);
      return structuredClone(setup);
    } catch (error) {
      this.leases.delete(setup.id);
      throw error;
    }
  }
  async authorize(setup: AgentTaskSetup): Promise<void> {
    const lease = this.leases.get(setup.id);
    if (
      !lease ||
      JSON.stringify(setup) !== JSON.stringify(lease.setup) ||
      Date.now() - lease.issued > 5 * 60_000
    )
      throw new Error('The reviewed task expired or changed. Request a new task.');
    const window = this.ports.window(setup.workspaceID);
    if (window?.id !== lease.owner || window.originID !== lease.originID)
      throw new Error('The selected workspace window closed or changed. Request a new task.');
    const workspace = selectAgentWorkspace(this.ports.workspaceState(), setup.workspaceID);
    if ((workspace.tasks?.length ?? 0) >= 50)
      throw new Error('A workspace supports up to 50 task areas.');
    for (const pane of workspace.panes) {
      if (pane.type === 'search' && pane.allLocations)
        throw new Error('This workspace searches outside the client folder scope.');
      await this.ports.authorize(pane.path);
    }
    for (const file of [setup.repo, path.dirname(setup.destination), setup.destination])
      await this.authorizePath(file);
  }
  private async authorizePath(file: string): Promise<void> {
    const planned = [...this.leases.values()].some((lease) => lease.setup.destination === file);
    if (planned) {
      await this.ports.authorize(path.dirname(file));
      try {
        await lstat(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
    }
    await this.ports.authorize(file);
  }
  async execute(
    setup: AgentTaskSetup,
    progress: (result: AgentTaskResult) => void,
  ): Promise<AgentTaskResult> {
    if (this.running.has(setup.id)) throw new Error('This task is already being created.');
    const abort = new AbortController();
    this.running.set(setup.id, abort);
    try {
      await this.authorize(setup);
      const lease = this.leases.get(setup.id)!;
      const target: CapturedTarget = {
        workspaceID: setup.workspaceID,
        rootID: setup.id,
        paneID: setup.id,
        directory: setup.repo,
        panePath: setup.repo,
        originID: lease.originID,
        selection: [],
      };
      abort.signal.throwIfAborted();
      progress({
        workspaceID: setup.workspaceID,
        taskID: setup.id,
        path: setup.destination,
        branch: setup.branch,
        commit: setup.commit,
        terminal: 'stopped',
        stage: 'worktree-pending',
      });
      const reply = await this.worktrees.request(
        {
          kind: 'create',
          target,
          catalogID: setup.catalogID,
          checkout: setup.checkout,
          destination: setup.destination,
        },
        lease.owner,
        abort.signal,
      );
      if (reply.kind !== 'created') throw new Error('Worktree creation was not confirmed.');
      const result: AgentTaskResult = {
        workspaceID: setup.workspaceID,
        taskID: setup.id,
        path: reply.entry.path,
        branch: setup.branch,
        commit: setup.commit,
        terminal: 'stopped',
        stage: 'worktree-created',
      };
      progress(result);
      abort.signal.throwIfAborted();
      await this.authorize(setup);
      const note = await this.ports.note(reply.entry.path);
      abort.signal.throwIfAborted();
      const bundle = taskBundle(setup, reply.entry, note, this.ports.profile());
      await this.ports.flush?.(lease.owner);
      await assertAgentCheckoutSafe(setup.repo, abort.signal);
      await this.authorize(setup);
      abort.signal.throwIfAborted();
      await this.ports.present(bundle, lease.owner);
      const ready: AgentTaskResult = {
        ...result,
        stage: 'ready',
        planeIDs: bundle.panes.map((pane) => pane.id),
      };
      progress(ready);
      return ready;
    } finally {
      const lease = this.leases.get(setup.id);
      if (lease && setup.catalogID)
        await this.worktrees
          .request({ kind: 'release', catalogID: setup.catalogID }, lease.owner)
          .catch(() => {});
      this.running.delete(setup.id);
      this.leases.delete(setup.id);
    }
  }
  cancel(id: string): void {
    const running = this.running.get(id);
    if (running)
      running.abort(new Error('Task creation cancelled. Any created worktree is retained.'));
    else {
      const lease = this.leases.get(id);
      if (lease?.setup.catalogID)
        void this.worktrees
          .request({ kind: 'release', catalogID: lease.setup.catalogID }, lease.owner)
          .catch(() => {});
      this.leases.delete(id);
    }
  }
  stopOwner(owner: number): void {
    for (const [id, lease] of this.leases) if (lease.owner === owner) this.cancel(id);
    this.worktrees.stopOwner(owner);
  }
  async quiesce(): Promise<void> {
    for (const id of this.running.keys()) this.cancel(id);
    await this.worktrees.quiesce();
  }
  close(): void {
    for (const id of this.running.keys()) this.cancel(id);
    this.worktrees.close();
  }
}

function taskBundle(
  setup: AgentTaskSetup,
  entry: FileEntry,
  note: NoteDocument,
  profile: string,
): AgentTaskBundle {
  const panes: AgentTaskBundle['panes'] = [
    { id: randomUUID(), type: 'task', areaID: setup.id, path: entry.path, title: setup.name },
    {
      id: randomUUID(),
      type: 'folder',
      path: entry.path,
      mode: 'list',
      sort: 'name',
      descending: false,
      showHidden: false,
      history: [entry.path],
      historyIndex: 0,
    },
    { id: randomUUID(), type: 'note', path: entry.path, documentID: note.id, title: note.title },
    {
      id: randomUUID(),
      type: 'terminal',
      path: entry.path,
      profileID: profile,
      taskSessionID: randomUUID(),
    },
    { id: randomUUID(), type: 'git-changes', path: entry.path, activation: 'manual' },
  ];
  const terminal = panes[3];
  if (terminal?.type !== 'terminal') throw new Error('Task terminal is unavailable.');
  const now = Date.now();
  const bundle: AgentTaskBundle = {
    workspaceID: setup.workspaceID,
    note,
    area: {
      id: setup.id,
      name: setup.name,
      checkout: {
        path: entry.path,
        branch: setup.branch,
        commit: setup.commit,
        identity: entry.identity,
        observed: now,
      },
      members: [
        {
          id: randomUUID(),
          title: 'Checkout',
          reference: { kind: 'folder', path: entry.path },
          views: [panes[1]!.id],
        },
        {
          id: randomUUID(),
          title: note.title,
          reference: { kind: 'note', path: entry.path, documentID: note.id },
          views: [panes[2]!.id],
        },
        {
          id: randomUUID(),
          title: 'Terminal',
          reference: {
            kind: 'terminal',
            path: entry.path,
            profileID: terminal.profileID,
            sessionID: terminal.taskSessionID!,
          },
          views: [terminal.id],
        },
        {
          id: randomUUID(),
          title: 'Git changes',
          reference: { kind: 'git-changes', path: entry.path },
          views: [panes[4]!.id],
        },
      ],
      created: now,
      updated: now,
    },
    panes,
  };

  return bundle;
}
