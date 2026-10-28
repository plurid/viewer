import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentTaskWorkflows } from '../src/desktop/agents/task-workflow';
import { AgentRequests } from '../src/desktop/agents/agent-requests';
import type { AgentServiceContext } from '../src/desktop/agents/service-tools';
import { SettingsService } from '../src/desktop/preferences/settings';
import { Notes } from '../src/desktop/editing/notes';
import { temporaryRoot } from '../tools/temporary';
import { parseCLI } from '../src/domain/cli/arguments';
import {
  selectAgentWorkspace,
  type AgentTaskBundle,
  type AgentTaskResult,
} from '../src/domain/agents/task-workflow';
import type { AgentWorkspaceSnapshot } from '../src/domain/agents/requests';
import { gitBlobs } from '../src/desktop/comparison/git-blobs';

const execute = promisify(execFile);
const services: AgentTaskWorkflows[] = [];
afterEach(() => {
  services.splice(0).forEach((service) => service.close());
});
it('does not probe Git or folders when task creation is unavailable', async () => {
  const authorize = vi.fn(async (file: string) => file),
    require = vi.fn(async () => {});
  const tasks = new AgentTaskWorkflows({
    available: () => false,
    authorize,
    workspaceState: () => undefined,
    window: () => undefined,
    profile: () => 'default',
    note: async () => {
      throw new Error('Unexpected note');
    },
    present: async () => {},
  });
  services.push(tasks);
  await expect(
    tasks.prepare(
      {
        name: 'Task',
        repo: '/generated/repo',
        path: '/generated/new',
        branch: 'feature',
        existing: false,
      },
      {
        clientID: 'test',
        signal: new AbortController().signal,
        authorize,
        require,
        workspaceState: async () => undefined,
        catalog: () => undefined,
        own: () => {},
      },
    ),
  ).rejects.toThrow('direct build only');
  expect(authorize).not.toHaveBeenCalled();
  expect(require).not.toHaveBeenCalled();
});
async function fixture() {
  const root = await realpath(await temporaryRoot('viewer-cli-task-'));
  const repo = path.join(root, 'Repository'),
    profile = path.join(root, 'Profile'),
    templates = path.join(root, 'Empty templates');
  await Promise.all([repo, profile, templates].map((directory) => mkdir(directory)));
  const git = async (...args: string[]) =>
    (
      await execute(
        '/usr/bin/git',
        [
          '-c',
          'core.hooksPath=/dev/null',
          '-c',
          'commit.gpgSign=false',
          '-c',
          'core.fsmonitor=false',
          '-c',
          'gc.auto=0',
          '-C',
          repo,
          ...args,
        ],
        {
          timeout: 10000,
          env: {
            PATH: '/usr/bin:/bin',
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_AUTHOR_NAME: 'Generated fixture',
            GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
            GIT_COMMITTER_NAME: 'Generated fixture',
            GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
          },
        },
      )
    ).stdout.trim();
  await git('init', '--initial-branch=main', '--template=' + templates);
  await writeFile(path.join(repo, 'Hello.txt'), 'Generated task workflow fixture.\n', {
    flag: 'wx',
  });
  await git('add', '--', 'Hello.txt');
  await git('commit', '--no-verify', '--no-gpg-sign', '-m', 'Generated baseline');
  const state: AgentWorkspaceSnapshot = {
    activeWorkspace: 'first',
    workspaces: [
      { id: 'first', name: 'First', panes: [], roots: [] },
      { id: 'second', name: 'Target workspace', panes: [], roots: [] },
    ],
  };
  let alive = true;
  const denied = new Set<string>();
  const authorize = vi.fn(async (file: string) => {
    if (denied.has(file) || (file !== root && !file.startsWith(root + path.sep)))
      throw new Error('Outside folder grants');
    return file;
  });
  const context: AgentServiceContext = {
    clientID: 'test-client',
    signal: new AbortController().signal,
    authorize,
    require: vi.fn(async () => {}),
    workspaceState: async () => state,
    catalog: () => undefined,
    own: vi.fn(),
  };
  const notes = new Notes(profile);
  const present = vi.fn(async (_bundle: AgentTaskBundle, _owner: number) => {});
  const flush = vi.fn(async (_owner: number) => {});
  const tasks = new AgentTaskWorkflows({
    available: () => true,
    authorize,
    workspaceState: () => state,
    window: () => (alive ? { id: 1, originID: 'generated-window' } : undefined),
    note: async (directory) => {
      const reply = await notes.request({ kind: 'create', format: 'note', directory });
      if (reply.kind !== 'document') throw new Error('Note unavailable');
      return reply.document;
    },
    present,
    flush,
    profile: () => 'default',
  });
  services.push(tasks);
  const input = {
    name: 'Implement feature',
    repo,
    path: path.join(root, 'Feature worktree'),
    branch: 'feature/cli',
    existing: false,
    workspace: 'Target workspace',
  };
  return {
    root,
    profile,
    repo,
    git,
    state,
    context,
    tasks,
    present,
    flush,
    notes,
    denied,
    input,
    stop: () => {
      alive = false;
    },
  };
}

it('parses task parameters without a shell, resolves paths once and supports workspace IDs', () => {
  const result = parseCLI(
    [
      'task',
      'create',
      'Ship the feature',
      '--branch',
      'feature/ship',
      '--path',
      '../Ship',
      '--workspace',
      'work-id',
      '--json',
    ],
    (file) => path.resolve('/projects/repository', file),
  );
  expect(result.parameters).toEqual({
    name: 'Ship the feature',
    repo: '/projects/repository',
    branch: 'feature/ship',
    path: '/projects/Ship',
    workspace: 'work-id',
  });
  expect(result.command?.tool).toBe('propose_task_create');
  expect(parseCLI(['workspace', 'switch', '--id', 'work-id'], (file) => file).parameters).toEqual({
    workspaceID: 'work-id',
  });
  expect(() => parseCLI(['workspace', 'switch', 'Name', '--id', 'ID'], (file) => file)).toThrow(
    'not both',
  );
  expect(() =>
    parseCLI(
      ['task', 'create', 'Task', '--branch', 'x', '--path', '/p', '--existing', '--base', 'main'],
      (file) => file,
    ),
  ).toThrow('not both');
});
it('resolves exact normalized names and refuses duplicate names or unavailable IDs', () => {
  const state: AgentWorkspaceSnapshot = {
    activeWorkspace: '1',
    workspaces: [
      { id: '1', name: 'Café', panes: [], roots: [] },
      { id: '2', name: 'Cafe\u0301', panes: [], roots: [] },
    ],
  };
  expect(selectAgentWorkspace(state, '1').id).toBe('1');
  expect(() => selectAgentWorkspace(state, 'Café')).toThrow('ambiguous');
  expect(() => selectAgentWorkspace(state, 'missing')).toThrow('unavailable');
});
it('creates and verifies a real branch/worktree with one durable note and a stopped terminal in the selected workspace', async () => {
  const f = await fixture(),
    setup = await f.tasks.prepare(f.input, f.context);
  const commit = await f.git('rev-parse', 'HEAD');
  expect(setup).toMatchObject({ workspaceID: 'second', commit });
  const progress: AgentTaskResult[] = [];
  const result = await f.tasks.execute(setup, (value) => progress.push(value));
  expect(result).toMatchObject({
    path: f.input.path,
    workspaceID: 'second',
    branch: 'feature/cli',
    commit,
    stage: 'ready',
    terminal: 'stopped',
  });
  expect(await readFile(path.join(result.path, 'Hello.txt'), 'utf8')).toContain('Generated');
  expect(await f.git('rev-parse', 'feature/cli')).toBe(commit);
  expect(progress.map((item) => item.stage)).toEqual([
    'worktree-pending',
    'worktree-created',
    'ready',
  ]);
  expect(f.present).toHaveBeenCalledOnce();
  const [bundle] = f.present.mock.calls[0]!;
  expect(bundle.panes.map((pane) => pane.type)).toEqual([
    'task',
    'folder',
    'note',
    'terminal',
    'git-changes',
  ]);
  expect(bundle.area.members).toHaveLength(4);
  expect(bundle.area.checkout.identity).toBeTruthy();
  expect(
    await f.notes.request({
      kind: 'read',
      id: bundle.panes[2]!.type === 'note' ? bundle.panes[2]!.documentID : randomUUID(),
    }),
  ).toMatchObject({ kind: 'document', document: { directory: result.path, text: '' } });
  await expect(f.tasks.execute(setup, () => {})).rejects.toThrow('expired');
});
it('supports an unattached existing branch and rejects occupied branches and changed base revisions', async () => {
  const f = await fixture();
  await f.git('branch', 'existing');
  const setup = await f.tasks.prepare(
    { ...f.input, branch: 'existing', existing: true },
    f.context,
  );
  expect((await f.tasks.execute(setup, () => {})).branch).toBe('existing');
  await expect(
    f.tasks.prepare(
      { ...f.input, branch: 'main', existing: true, path: path.join(f.root, 'Other') },
      f.context,
    ),
  ).rejects.toThrow('already has');
  const stale = await f.tasks.prepare({ ...f.input, path: path.join(f.root, 'Stale') }, f.context);
  await f.git('commit', '--allow-empty', '--no-verify', '--no-gpg-sign', '-m', 'Move base');
  await expect(f.tasks.execute(stale, () => {})).rejects.toThrow(/changed/);
});
it('rechecks scope and the workspace owner, refuses symlinks, collisions and parameter tampering', async () => {
  const f = await fixture();
  const setup = await f.tasks.prepare(f.input, f.context);
  await expect(f.tasks.execute({ ...setup, branch: 'tampered' }, () => {})).rejects.toThrow(
    'changed',
  );
  const next = await f.tasks.prepare({ ...f.input, branch: 'next' }, f.context);
  f.denied.add(f.repo);
  await expect(f.tasks.execute(next, () => {})).rejects.toThrow('grants');
  f.denied.clear();
  const window = await f.tasks.prepare({ ...f.input, branch: 'window' }, f.context);
  f.stop();
  await expect(f.tasks.execute(window, () => {})).rejects.toThrow('window');
  await mkdir(f.input.path);
  await expect(f.tasks.prepare(f.input, f.context)).rejects.toThrow('Open the selected');
  const g = await fixture();
  const alias = path.join(g.root, 'Alias');
  await symlink(g.repo, alias);
  await expect(g.tasks.prepare({ ...g.input, repo: alias }, g.context)).rejects.toThrow('ordinary');
  await expect(g.tasks.prepare({ ...g.input, path: g.repo }, g.context)).rejects.toThrow(
    'already exists',
  );
});
it('retains a created worktree and structured recovery result when task presentation fails', async () => {
  const f = await fixture(),
    setup = await f.tasks.prepare(f.input, f.context);
  const progress: AgentTaskResult[] = [];
  f.present.mockRejectedValueOnce(new Error('Workspace closed before acknowledgement'));
  await expect(f.tasks.execute(setup, (value) => progress.push(value))).rejects.toThrow(
    'Workspace closed',
  );
  expect(progress.at(-1)).toMatchObject({
    path: f.input.path,
    stage: 'worktree-created',
    terminal: 'stopped',
  });
  expect(await readFile(path.join(f.input.path, 'Hello.txt'), 'utf8')).toContain('Generated');
  expect(await f.git('rev-parse', 'feature/cli')).toBe(setup.commit);
});
it('cancellation while existing drafts flush cannot open a late task and retains the checkout', async () => {
  const f = await fixture(),
    setup = await f.tasks.prepare(f.input, f.context);
  let release!: () => void;
  f.flush.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const progress: AgentTaskResult[] = [];
  const work = f.tasks
    .execute(setup, (value) => progress.push(value))
    .catch((error: Error) => error);
  await vi.waitFor(() => expect(f.flush).toHaveBeenCalledOnce());
  f.tasks.cancel(setup.id);
  release();
  expect(await work).toBeInstanceOf(Error);
  expect(f.present).not.toHaveBeenCalled();
  expect(progress.at(-1)?.stage).toBe('worktree-created');
  expect(await readFile(path.join(f.input.path, 'Hello.txt'), 'utf8')).toContain('Generated');
});
it('never invokes repository hooks or executable filters and streams multiple raw blobs correctly', async () => {
  const f = await fixture();
  await mkdir(path.join(f.repo, '.git/hooks'));
  await writeFile(path.join(f.repo, '.git/hooks/post-checkout'), '#!/bin/sh\nexit 93\n', {
    flag: 'wx',
    mode: 0o755,
  });
  const setup = await f.tasks.prepare(f.input, f.context);
  expect((await f.tasks.execute(setup, () => {})).stage).toBe('ready');
  expect(await f.git('status', '--porcelain')).toBe('');
  const hash = await f.git('rev-parse', 'HEAD:Hello.txt');
  const buffers: Buffer[] = [];
  for await (const blob of gitBlobs(
    f.repo,
    [
      { object: hash, size: 33 },
      { object: hash, size: 33 },
    ],
    new AbortController().signal,
  ))
    buffers.push(blob);
  expect(buffers).toHaveLength(2);
  expect(buffers[0]).toEqual(buffers[1]);
  await f.git('config', 'filter.fixture.process', 'exit 94');
  await expect(
    f.tasks.prepare(
      { ...f.input, path: path.join(f.root, 'Filtered'), branch: 'filtered' },
      f.context,
    ),
  ).rejects.toThrow('executable Git filters');
});
it('keeps the same native review boundary for parameterized CLI task creation', async () => {
  const f = await fixture(),
    settings = new SettingsService(
      f.profile,
      f.repo,
      () => true,
      () => {},
    );
  await settings.load();
  const confirm = vi.fn(async () => false);
  const requests = new AgentRequests(
    f.profile,
    settings,
    () => {},
    async () => {},
    { read: () => ({ cwd: f.repo, output: '' }) },
    undefined,
    undefined,
    confirm,
    undefined,
    undefined,
    (setup, progress) => f.tasks.execute(setup, progress),
  );
  const setup = await f.tasks.prepare(f.input, f.context);
  const proposal = requests.taskWorkflow(setup);
  await expect(requests.review(proposal.id, true)).rejects.toThrow('not confirmed');
  expect(requests.get(proposal.id).status).toBe('review');
  expect(f.present).not.toHaveBeenCalled();
  confirm.mockResolvedValue(true);
  await requests.review(proposal.id, true);
  expect(requests.get(proposal.id)).toMatchObject({
    status: 'completed',
    taskResult: { stage: 'ready', workspaceID: 'second', terminal: 'stopped' },
  });
});
