/** In-memory security regressions. No real files, processes or Trash are used or removed. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import type { FileEntry, OperationJob } from '../src/domain/contracts';
import type { CapturedTarget, CustomAction } from '../src/domain/automation';
import type { AgentProposal, CommandDescriptor } from '../src/domain/agent-requests';
import { agentCommandID, agentRemovalPolicy } from '../src/domain/agent-safety';
import { SettingsService } from '../src/desktop/settings';
import { AgentRequests } from '../src/desktop/agent-requests';
import { AgentBroker } from '../src/desktop/agent-broker';
import type { FileServices } from '../src/desktop/file-services';
import type { ActionPlanner } from '../src/desktop/actions/planner';
import type * as FileSystem from '../src/desktop/filesystem';
import { Operations } from '../src/desktop/operations';

const memory = vi.hoisted(() => ({
  stores: new Map<string, unknown>(),
  files: new Map<string, FileEntry>(),
  aliases: new Map<string, string>(),
  operations: new Map<string, OperationJob>(),
  beforeCoordinate: undefined as (() => void) | undefined,
  remove: vi.fn(async () => {
    throw new Error('This test must never delete real files.');
  }),
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof fs>();
  const safe = {
    realpath: async (file: string) => memory.aliases.get(String(file)) ?? String(file),
    stat: async () => ({ isDirectory: () => true }),
    rm: memory.remove,
    unlink: memory.remove,
    rmdir: memory.remove,
  };
  return { ...original, ...safe, default: { ...original, ...safe } };
});
vi.mock('../src/desktop/document-store', () => ({
  DocumentStore: class {
    constructor(
      public file: string,
      private validate: (value: unknown) => unknown,
    ) {}
    async load() {
      const value = memory.stores.get(this.file);
      return value === undefined ? undefined : this.validate(structuredClone(value));
    }
    async save(value: unknown) {
      memory.stores.set(this.file, structuredClone(value));
    }
    async flush() {}
  },
}));
vi.mock('../src/desktop/filesystem', async (importOriginal) => ({
  ...(await importOriginal<typeof FileSystem>()),
  absolute: (file: string) => {
    if (!path.isAbsolute(file)) throw new Error('Absolute paths are required.');
    return path.normalize(file);
  },
  entry: async (file: string) => {
    const value = memory.files.get(file);
    if (!value) throw new Error('Missing in-memory source.');
    return structuredClone(value);
  },
}));
vi.mock('../src/desktop/file-coordination', () => ({
  fileCoordination: {
    run: async (
      _intents: unknown,
      work: (signal?: AbortSignal) => Promise<unknown>,
      signal?: AbortSignal,
    ) => {
      memory.beforeCoordinate?.();
      return work(signal);
    },
    path: (file: string) => file,
    purpose: () => 'in-memory safety test',
  },
}));

function item(file = '/Granted/Report.txt'): FileEntry {
  return {
    path: file,
    name: path.basename(file),
    parent: path.dirname(file),
    extension: 'txt',
    kind: 'file',
    directory: false,
    identity: '1:2',
    modified: 10,
    created: 1,
    size: 5,
    hidden: false,
    mime: 'text/plain',
  };
}
function action(executor: CustomAction['executor']): CustomAction {
  return {
    id: 'cleanup',
    name: 'Convenient action',
    aliases: [],
    icon: 'command',
    shortcut: '',
    order: 0,
    pinned: false,
    when: { target: 'any', extensions: [], min: 0, max: 10000 },
    executor,
  };
}
async function fixture(roots = ['/Granted']) {
  const settings = new SettingsService(
    '/Memory/Viewer',
    '/Home',
    () => true,
    () => {},
  );
  const config = settings.snapshot().settings;
  config.agents.enabled = true;
  config.agents.roots = roots;
  config.browsing.confirmTrash = false;
  config.customActions = [action({ kind: 'builtin', command: 'trash' })];
  const file = item();
  memory.files.set(file.path, file);
  const target: CapturedTarget = {
    workspaceID: 'workspace',
    rootID: 'root',
    paneID: 'folder',
    directory: '/Granted',
    panePath: '/Granted',
    selection: [file],
  };
  const commands: CommandDescriptor[] = [
    'trash',
    'custom.cleanup',
    'copy-path',
    'open-terminal',
  ].map((id) => ({ id, label: id, group: 'Files', aliases: [] }));
  const execute = vi.fn(async (): Promise<void | { operationID: string }> => {}),
    write = vi.fn();
  const cancelOperation = vi.fn();
  const requests: AgentRequests = new AgentRequests(
    '/Memory/Viewer',
    settings,
    () => {},
    execute,
    { read: () => ({ cwd: '/Granted', output: 'Screen' }), write },
    undefined,
    {
      actor: () => broker.clients.actor(),
      check: (proposal) => broker.authorizeProposal(proposal),
      run: (clientID, work) => broker.clients.context.run(clientID, work),
      executeAllowed: async () => true,
      cancelExecution: () => {},
      cancelOperation,
      operation: (id) => memory.operations.get(id),
    },
  );
  const broker: AgentBroker = new AgentBroker(
    '/Memory/Viewer',
    () => config,
    () => ({
      workspaceID: 'workspace',
      rootID: 'root',
      paneID: 'folder',
      sources: [],
      actor: 'user',
    }),
    {} as FileServices,
    { all: async () => [], cancel: () => {} } as unknown as ActionPlanner,
    { requests, config: settings, catalog: () => ({ target, commands }), access: async () => {} },
  );
  const created = (await broker.clientRequest({
    kind: 'create',
    client: {
      name: 'Safety fixture',
      roots,
      capabilities: ['metadata', 'propose', 'execute', 'terminal-write'],
      budgets: { maxReadBytes: 1024 * 1024, maxTasks: 4 },
    },
  })) as { client: { id: string; revision: number }; token: string };
  async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const result = (await broker.handle(created.token, {
      method: 'tools/call',
      params: { name, arguments: args },
    })) as { content: { text: string }[] };
    return JSON.parse(result.content[0].text) as T;
  }
  return {
    settings,
    config,
    target,
    execute,
    write,
    cancelOperation,
    requests,
    broker,
    created,
    call,
  };
}
beforeEach(() => {
  memory.stores.clear();
  memory.files.clear();
  memory.aliases.clear();
  memory.operations.clear();
  memory.remove.mockClear();
  memory.beforeCoordinate = undefined;
});

describe('agent removal safety', () => {
  it('reports the native removal job outcome rather than premature command success', async () => {
    const f = await fixture();
    const trash = vi.fn(async () => {
      throw new Error('Trash unavailable');
    });
    const operations = new Operations(trash, (job) => {
      memory.operations.set(job.id, job);
      f.requests.operation(job);
    });
    f.execute.mockImplementationOnce(async () => {
      const operationID = operations.start({ kind: 'trash', sources: ['/Granted/Report.txt'] });
      // Finish before returning the ID to exercise the early-completion race.
      await vi.waitFor(() => expect(operations.all()[0].status).toBe('failed'));
      return { operationID };
    });
    const proposal = await f.call<{ id: string }>('propose_command', { commandID: 'trash' });
    await f.requests.review(proposal.id, true);
    expect(f.requests.get(proposal.id)).toMatchObject({
      status: 'failed',
      error: 'Trash unavailable',
    });
    expect(memory.remove).not.toHaveBeenCalled();
    await operations.close();
  });
  it('cancels an approved but queued removal when its client is stopped', async () => {
    const f = await fixture();
    const trash = vi.fn(async () => {});
    const operations = new Operations(trash, (job) => {
      memory.operations.set(job.id, job);
      f.requests.operation(job);
    });
    let release!: () => void, entered!: () => void;
    const active = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holding = operations.exclusive(async () => {
      entered();
      await gate;
    });
    await active;
    f.cancelOperation.mockImplementation((id: string) => operations.cancel(id));
    f.execute.mockImplementationOnce(async () => ({
      operationID: operations.start({ kind: 'trash', sources: ['/Granted/Report.txt'] }),
    }));
    const proposal = await f.call<{ id: string }>('propose_command', { commandID: 'trash' });
    await f.requests.review(proposal.id, true);
    expect(f.requests.get(proposal.id).status).toBe('running');
    await f.broker.clientRequest({
      kind: 'revoke',
      id: f.created.client.id,
      revision: f.created.client.revision,
    });
    release();
    await holding;
    await vi.waitFor(() => expect(operations.all()[0].status).toBe('cancelled'));
    expect(f.requests.get(proposal.id).status).toBe('cancelled');
    expect(f.cancelOperation).toHaveBeenCalledOnce();
    expect(trash).not.toHaveBeenCalled();
    expect(memory.remove).not.toHaveBeenCalled();
    await operations.close();
  });
  it('checks the reviewed source again inside native Trash coordination', async () => {
    const file = item();
    memory.files.set(file.path, file);
    const trash = vi.fn(async () => {});
    const operations = new Operations(trash, () => {});
    memory.beforeCoordinate = () => memory.files.set(file.path, { ...file, modified: 99 });
    const id = operations.start({
      kind: 'trash',
      sources: [file.path],
      expectedSources: [
        {
          path: file.path,
          version: { identity: file.identity, modified: file.modified, size: file.size },
        },
      ],
    });
    await vi.waitFor(() =>
      expect(operations.all().find((job) => job.id === id)?.status).toBe('failed'),
    );
    expect(trash).not.toHaveBeenCalled();
    expect(operations.all()[0].errors[0].message).toContain('This item was not moved to Trash');
    expect(memory.remove).not.toHaveBeenCalled();
    await operations.close();
  });
  it('fails a Trash error without retrying through permanent filesystem deletion', async () => {
    const file = item();
    memory.files.set(file.path, file);
    const trash = vi.fn(async () => {
      throw new Error('Trash unavailable');
    });
    const operations = new Operations(trash, () => {});
    const id = operations.start({ kind: 'trash', sources: [file.path] });
    await vi.waitFor(() =>
      expect(operations.all().find((job) => job.id === id)?.status).toBe('failed'),
    );
    expect(trash).toHaveBeenCalledOnce();
    expect(operations.all()[0].errors[0].message).toContain('Trash unavailable');
    expect(memory.remove).not.toHaveBeenCalled();
    await operations.close();
  });
  it('creates an exact-path Trash proposal and never treats hidden UI confirmation as approval', async () => {
    const f = await fixture();
    const proposal = await f.call<{ id: string; requiresUserReview: boolean }>('propose_command', {
      commandID: 'trash',
    });
    expect(proposal.requiresUserReview).toBe(true);
    expect(f.execute).not.toHaveBeenCalled();
    const captured = await f.call<AgentProposal>('get_proposal', { id: proposal.id });
    expect(captured).toMatchObject({ status: 'review', removal: 'trash', title: 'Move to Trash' });
    expect(captured.detail).toContain('/Granted/Report.txt');
    expect(captured.detail).toContain('Nothing is permanently deleted');
    await f.requests.review(proposal.id, false);
    expect(f.execute).not.toHaveBeenCalled();
    expect(memory.remove).not.toHaveBeenCalled();
  });
  it('ignores valid legacy execution grants even for custom aliases to Trash', async () => {
    const f = await fixture();
    memory.stores.set('/Memory/Viewer/execution-approvals-v1.json', [
      {
        id: 'old-grant',
        clientID: f.created.client.id,
        actionID: 'custom.cleanup',
        root: '/Granted',
        capability: 'execute',
        fingerprint: createHash('sha256')
          .update(JSON.stringify(f.config.customActions[0]))
          .digest('hex'),
      },
    ]);
    expect(await f.requests.listGrants()).toHaveLength(1);
    const first = await f.call<{ id: string; requiresUserReview: boolean }>('propose_command', {
      commandID: 'custom.cleanup',
    });
    expect(first.requiresUserReview).toBe(true);
    expect(f.requests.get(first.id).removal).toBe('trash');
    expect(f.execute).not.toHaveBeenCalled();
    // Approval is simulated against an in-memory dispatcher, never real files.
    await f.requests.review(first.id, true);
    expect(f.execute).toHaveBeenCalledOnce();
    await expect(f.requests.review(first.id, true)).rejects.toThrow('no longer needs review');
    const second = await f.call<{ requiresUserReview: boolean }>('propose_command', {
      commandID: 'custom.cleanup',
    });
    expect(second.requiresUserReview).toBe(true);
    expect(f.execute).toHaveBeenCalledOnce();
    await expect(f.requests.grant('custom.cleanup', '/Granted', 'execute', true)).rejects.toThrow(
      'approval each time',
    );
    expect(memory.remove).not.toHaveBeenCalled();
  });
  it('rejects a replaced or edited source before executing the reviewed removal', async () => {
    for (const change of [{ identity: '1:99' }, { modified: 11 }, { size: 9 }]) {
      const f = await fixture();
      const proposal = await f.call<{ id: string }>('propose_command', { commandID: 'trash' });
      memory.files.set('/Granted/Report.txt', { ...item(), ...change });
      await expect(f.requests.review(proposal.id, true)).rejects.toThrow('Selection changed');
      expect(f.execute).not.toHaveBeenCalled();
    }
  });
  it('fails closed when the canonical path escapes its grant or exposes private recovery data', async () => {
    const f = await fixture(['/']);
    f.target.selection = [item('/Memory/Viewer/recovery.json')];
    await expect(f.call('propose_command', { commandID: 'trash' })).rejects.toThrow(
      'Private Viewer',
    );
    const scoped = await fixture();
    memory.aliases.set('/Granted/Report.txt', '/Other/Report.txt');
    await expect(scoped.call('propose_command', { commandID: 'trash' })).rejects.toThrow('outside');
    expect(f.execute).not.toHaveBeenCalled();
    expect(scoped.execute).not.toHaveBeenCalled();
  });
  it('protects granted roots, Home, whole volumes, system directories and existing Trash contents', async () => {
    for (const file of [
      '/Granted',
      '/',
      '/System',
      '/Users',
      '/Volumes',
      os.homedir(),
      path.join(os.homedir(), '.Trash'),
      path.join(os.homedir(), '.Trash', 'Kept.txt'),
      path.join(os.homedir(), '.local/share/Trash/files', 'Kept.txt'),
      '/Volumes/External/.Trashes/501/Kept.txt',
    ]) {
      const f = await fixture(file === '/Granted' ? ['/Granted'] : ['/']);
      f.target.selection = [item(file)];
      await expect(f.call('propose_command', { commandID: 'trash' })).rejects.toThrow(
        'Agents cannot remove',
      );
      expect(f.execute).not.toHaveBeenCalled();
    }
  });
  it('rechecks permissions when the user approves a previously prepared request', async () => {
    const f = await fixture();
    const proposal = await f.call<{ id: string }>('propose_command', { commandID: 'trash' });
    await f.broker.clientRequest({
      kind: 'revoke',
      id: f.created.client.id,
      revision: f.created.client.revision,
    });
    await expect(f.requests.review(proposal.id, true)).rejects.toThrow('no longer needs review');
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('blocks opaque code and terminal input even when named clients retain old write capabilities', async () => {
    const f = await fixture();
    for (const command of [
      'open-default',
      'open-with',
      'open-selection',
      'undo-file',
      'parent-plane',
    ]) {
      expect(() => agentCommandID(command, [])).toThrow();
      f.config.customActions = [action({ kind: 'builtin', command })];
      await expect(f.call('propose_command', { commandID: 'custom.cleanup' })).rejects.toThrow();
    }
    for (const executor of [
      { kind: 'shell', executable: '/bin/zsh', script: 'rm -rf /Granted', perItem: false },
      { kind: 'executable', executable: '/bin/rm', args: ['-rf', '/Granted'], perItem: false },
      { kind: 'terminal', profileID: 'shell' },
    ] satisfies CustomAction['executor'][]) {
      f.config.customActions = [action(executor)];
      await expect(f.call('propose_command', { commandID: 'custom.cleanup' })).rejects.toThrow(
        'bypass Trash',
      );
    }
    await expect(
      f.call('write_terminal', { id: 'terminal', data: 'rm -rf /Granted\r' }),
    ).rejects.toThrow('permanently delete');
    await expect(f.requests.grant('*', '/Granted', 'terminal-write', true)).rejects.toThrow(
      'approval each time',
    );
    expect(f.write).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
    expect(memory.remove).not.toHaveBeenCalled();
  });
  it('advertises the immutable removal policy and excludes unsafe command/tool routes', async () => {
    const f = await fixture();
    f.config.customActions = [
      action({ kind: 'shell', executable: '/bin/zsh', script: 'ignored', perItem: false }),
    ];
    const catalog = await f.call<{ commands: { id: string }[]; removalPolicy: unknown }>(
      'list_commands',
    );
    expect(catalog.removalPolicy).toEqual(agentRemovalPolicy);
    expect(catalog.commands.map((command) => command.id)).toEqual(['trash', 'copy-path']);
    const list = (await f.broker.handle(f.created.token, { method: 'tools/list' })) as {
      tools: { name: string }[];
    };
    expect(
      list.tools.some((tool) =>
        ['write_terminal', 'delete', 'trash', 'apply', 'empty_trash'].includes(tool.name),
      ),
    ).toBe(false);
    for (const name of ['delete', 'trash', 'apply', 'empty_trash'])
      await expect(f.call(name)).rejects.toThrow();
  });
  it('rechecks changed custom actions at approval and rejects recursive aliases', async () => {
    const f = await fixture();
    const proposal = await f.call<{ id: string }>('propose_command', {
      commandID: 'custom.cleanup',
    });
    f.config.customActions = [
      action({ kind: 'executable', executable: '/bin/rm', args: [], perItem: false }),
    ];
    await expect(f.requests.review(proposal.id, true)).rejects.toThrow('bypass Trash');
    expect(() =>
      agentCommandID('custom.cleanup', [action({ kind: 'builtin', command: 'custom.cleanup' })]),
    ).toThrow('another custom action');
    expect(f.execute).not.toHaveBeenCalled();
  });
});
