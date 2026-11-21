import { itemIdentity } from '../src/domain/files/item-identity';
/** In-memory security regressions. No real files, processes or Trash are used or removed. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import {
  reportCopyChannel,
  reportOptionsChannel,
  reportUpdateChannel,
  reportShownChannel,
  reportReadyChannel,
} from '../src/domain/diagnostics/report-window';
import { runCLI } from '../src/desktop/cli/run';
import type { FileEntry, OperationJob } from '../src/domain/contracts';
import type { CapturedTarget, CustomAction } from '../src/domain/automation/actions';
import type { AgentProposal, CommandDescriptor } from '../src/domain/agents/requests';
import {
  agentCommandID,
  agentDispatchRefusal,
  agentRemovalPolicy,
  modelLineCommandProblem,
} from '../src/domain/agents/safety';
import { forbiddenTrashCommands } from '../src/domain/files/trash';
import { cliCommands } from '../src/domain/cli/catalog';
import { verbs } from '../src/domain/command-line/verbs';
import { workflowDefinitionSchema } from '../src/domain/automation/workflows';
import { agentTools } from '../src/desktop/agents/agent-tools';
import { SettingsService } from '../src/desktop/preferences/settings';
import { AgentRequests } from '../src/desktop/agents/agent-requests';
import { AgentBroker, redactedSettings } from '../src/desktop/agents/agent-broker';
import type { FileServices } from '../src/desktop/files/file-services';
import type { ActionPlanner } from '../src/desktop/actions/planner';
import type * as FileSystem from '../src/desktop/files/filesystem';
import { Operations } from '../src/desktop/operations/operations';
import { Resources } from '../src/desktop/previews/resources';
import { createResourceHandlers } from '../src/desktop/ipc/resource-handlers';
import { sourceVersion } from '../src/domain/files/inspection';

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
    stat: async () => ({ dev: 1n, ino: 1n, mode: 0o40700n, isDirectory: () => true }),
    rm: memory.remove,
    unlink: memory.remove,
    rmdir: memory.remove,
  };
  return { ...original, ...safe, default: { ...original, ...safe } };
});
vi.mock('../src/desktop/persistence/document-store', () => ({
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
vi.mock('../src/desktop/files/filesystem', async (importOriginal) => ({
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
vi.mock('../src/desktop/files/file-coordination', () => ({
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
async function fixture(roots = ['/Granted'], content = false, navigation = false) {
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
  const confirm = vi.fn(async (_proposal: AgentProposal) => true);
  const exportTransform = vi.fn(async (_proposal: AgentProposal) => ({
    operationID: 'typed-export',
  }));
  const navigate = vi.fn(async () => {});
  const requests: AgentRequests = new AgentRequests(
    '/Memory/Viewer',
    settings,
    () => {},
    execute,
    { read: () => ({ cwd: '/Granted', output: 'Screen' }) },
    navigation ? navigate : undefined,
    {
      actor: () => broker.clients.actor(),
      check: (proposal) => broker.authorizeProposal(proposal),
      run: (clientID, work) => broker.clients.context.run(clientID, work),
      cancelExecution: () => {},
      cancelOperation,
      operation: (id) => memory.operations.get(id),
    },
    confirm,
    exportTransform,
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
  const authority = { enabled: true, add: roots };
  await broker.access.approve(authority, await broker.access.captureReview(authority));
  const created = (await broker.clientRequest({
    kind: 'create',
    client: {
      name: 'Safety fixture',
      roots,
      capabilities: [
        'metadata',
        'propose',
        'execute',
        'terminal-write',
        ...(navigation ? ['navigation' as const] : []),
        ...(content ? ['content' as const] : []),
      ],
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
    navigate,
    execute,
    write,
    cancelOperation,
    confirm,
    exportTransform,
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
  it('keeps the actual report IPC route private to its own main frame', async () => {
    const clipboard = vi.fn(async (_text: string) => {});
    const contents = Object.assign(new EventEmitter(), {
      ipc: new EventEmitter(),
      mainFrame: {},
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    });
    class ReviewWindow extends EventEmitter {
      webContents = contents;
      isDestroyed = () => false;
      loadURL = vi.fn(async () => {
        contents.emit('did-start-loading');
        contents.ipc.emit(reportReadyChannel, {
          sender: contents,
          senderFrame: contents.mainFrame,
        });
      });
      show = vi.fn();
      close = vi.fn();
    }
    vi.doMock('electron', () => ({
      BrowserWindow: ReviewWindow,
      clipboard: { writeText: clipboard },
      dialog: { showErrorBox: vi.fn() },
      session: {
        fromPartition: () => ({
          setPermissionRequestHandler: vi.fn(),
          setPermissionCheckHandler: vi.fn(),
          webRequest: { onBeforeRequest: vi.fn() },
        }),
      },
    }));
    try {
      const { ReportWindow } = await import('../src/desktop/windows/report-window');
      const makeReport = vi.fn(async (include: boolean) =>
        include ? 'Explicit excerpt' : 'Structured report',
      );
      const review = new ReportWindow(
        async () => ({
          report: await makeReport(false),
          withMessageText: () => makeReport(true),
        }),
        () => 'dark',
        false,
      );
      await review.open();
      const agentContents = { id: 900, mainFrame: {} };
      for (const channel of [
        reportOptionsChannel,
        reportCopyChannel,
        reportShownChannel,
        reportReadyChannel,
      ]) {
        const args =
          channel === reportOptionsChannel ? [1, true] : channel === reportShownChannel ? [1] : [];
        contents.ipc.emit(
          channel,
          { sender: agentContents, senderFrame: contents.mainFrame },
          ...args,
        );
        contents.ipc.emit(channel, { sender: contents, senderFrame: {} }, ...args);
      }
      await Promise.resolve();
      expect(makeReport).toHaveBeenCalledExactlyOnceWith(false);
      expect(contents.send).not.toHaveBeenCalled();
      expect(clipboard).not.toHaveBeenCalled();

      // The positive control proves the test exercised the real installed route.
      const person = { sender: contents, senderFrame: contents.mainFrame };
      contents.ipc.emit(reportOptionsChannel, person, 1, true);
      await vi.waitFor(() =>
        expect(contents.send).toHaveBeenCalledWith(reportUpdateChannel, expect.any(Object)),
      );
      const update = contents.send.mock.calls[0]![1];
      contents.ipc.emit(reportShownChannel, person, update.revision);
      contents.ipc.emit(reportCopyChannel, person);
      await vi.waitFor(() => expect(clipboard).toHaveBeenCalledExactlyOnceWith('Explicit excerpt'));
    } finally {
      vi.doUnmock('electron');
    }
  });

  it('refuses the real content-read tool and CLI route for the diagnostic log and aliases', async () => {
    const f = await fixture(['/Granted', '/Memory'], true);
    const file = '/Memory/Viewer/Logs/diagnostics.log';
    await expect(f.call('read_content', { path: file })).rejects.toThrow('Private Viewer');
    memory.aliases.set('/Granted/log-alias', file);
    await expect(f.call('read_content', { path: '/Granted/log-alias' })).rejects.toThrow(
      'Private Viewer',
    );
    let output = '';
    const sink = new Writable({
      write(chunk, _encoding, done) {
        output += String(chunk);
        done();
      },
    });
    const code = await runCLI(
      ['tools', 'call', 'read_content', '--args', JSON.stringify({ path: file })],
      {
        dataPath: '/Memory/Viewer',
        version: 'test',
        cwd: '/Granted',
        home: '/Home',
        input: Readable.from([]),
        output: sink,
        error: sink,
        call: (method, params, signal) =>
          f.broker.handle(f.created.token, { method, params }, signal),
      },
    );
    expect(code).not.toBe(0);
    expect(output).toContain('Private Viewer');
    expect(f.execute).not.toHaveBeenCalled();
    await f.broker.close();
  });
  it('refuses Ghostscript through MCP, CLI and custom actions even with a saved execution grant', async () => {
    const f = await fixture(['/Granted'], true);
    f.config.customActions = [action({ kind: 'builtin', command: 'copy-path' })];
    const resources = new Resources();
    const render = vi.spyOn(resources, 'renderPostscript').mockImplementation(async () => {
      throw new Error('The render delegate was reached.');
    });
    const handler = createResourceHandlers({
      resources,
      thumbnails: { get: vi.fn() },
      webPreviews: { releaseResource: vi.fn() },
      files: { extract: vi.fn() },
      fileAccess: { require: vi.fn() },
      forgetGitResource: vi.fn(),
      warmOffice: vi.fn(),
      isAgent: (owner) => owner === 1,
    }).renderPostscript;
    expect(() => handler(['source', 'agent-render'], 1)).toThrow('never to agents');
    expect(render).not.toHaveBeenCalled();
    await expect(handler(['source', 'human-render'], 2)).rejects.toThrow('render delegate');
    render.mockClear();
    f.execute.mockImplementation(async () => {
      await handler(['source', 'dispatch-render'], 1);
    });
    memory.stores.set('/Memory/Viewer/execution-approvals-v1.json', [
      {
        id: 'old-render-grant',
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
    await expect(f.call('renderPostscript', { id: 'source', requestID: 'render' })).rejects.toThrow(
      'Unknown agent tool',
    );
    const proposal = await f.call<{ id: string }>('propose_command', {
      commandID: 'custom.cleanup',
    });
    await expect(f.requests.review(proposal.id, true)).rejects.toThrow('never to agents');
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.requests.get(proposal.id).status).toBe('failed');
    expect(render).not.toHaveBeenCalled();
    let output = '';
    const sink = new Writable({
      write(chunk, _encoding, done) {
        output += String(chunk);
        done();
      },
    });
    const code = await runCLI(['tools', 'call', 'renderPostscript', '--args', '{}'], {
      dataPath: '/Memory/Viewer',
      version: 'test',
      cwd: '/Granted',
      home: '/Home',
      input: Readable.from([]),
      output: sink,
      error: sink,
      call: (method, params, signal) =>
        f.broker.handle(f.created.token, { method, params }, signal),
    });
    expect(code).not.toBe(0);
    expect(output).toContain('Unknown agent tool');
    expect(render).not.toHaveBeenCalled();
    await f.broker.close();
  });
  it.each(['disable', 'remove-folder', 'capabilities'] as const)(
    'retires proposals when shared authority narrows: %s',
    async (kind) => {
      const f = await fixture();
      const grant = { capabilities: ['metadata', 'propose'] as const };
      await f.broker.access.approve(grant, await f.broker.access.captureReview(grant));
      const proposal = await f.call<{ id: string }>('propose_command', { commandID: 'copy-path' });
      expect(f.requests.get(proposal.id).status).toBe('review');
      await f.broker.access.approve(
        kind === 'disable'
          ? { enabled: false }
          : kind === 'remove-folder'
            ? { remove: ['/Granted'] }
            : { capabilities: ['metadata'] },
      );
      expect(f.requests.get(proposal.id).status).toBe('cancelled');
      expect(f.execute).not.toHaveBeenCalled();
      await f.broker.close();
    },
  );
  it('cancels outstanding reviews on broker close and rejects new requests until restarted', async () => {
    const f = await fixture();
    const proposal = await f.call<{ id: string }>('propose_command', { commandID: 'copy-path' });
    await f.broker.close();
    expect(f.requests.get(proposal.id).status).toBe('cancelled');
    await expect(f.call('list_commands')).rejects.toThrow('disabled');
  });
  it('admits only granted typed exports with content permission, fresh review and unchanged sources', async () => {
    const denied = await fixture();
    const input = {
      sources: [denied.target.selection[0].path],
      destination: '/Granted',
      name: 'preview.webp',
      plan: { kind: 'image', format: 'webp' },
    };
    await expect(denied.call('propose_transform', input)).rejects.toThrow();
    expect(denied.exportTransform).not.toHaveBeenCalled();
    const allowed = await fixture(['/Granted'], true);
    await expect(
      allowed.call('propose_transform', { ...input, destination: '/Outside' }),
    ).rejects.toThrow('outside');
    await expect(
      allowed.call('propose_transform', {
        ...input,
        plan: { ...input.plan, argv: ['-filter_complex', 'movie=https://outside'] },
      }),
    ).rejects.toThrow();
    const proposal = await allowed.call<{ id: string }>('propose_transform', input);
    expect(allowed.exportTransform).not.toHaveBeenCalled();
    expect(allowed.requests.get(proposal.id)).toMatchObject({
      kind: 'transform',
      status: 'review',
    });
    await allowed.requests.review(proposal.id, true);
    expect(allowed.exportTransform).toHaveBeenCalledOnce();
    await expect(allowed.requests.review(proposal.id, true)).rejects.toThrow(
      'no longer needs review',
    );
    const changed = await allowed.call<{ id: string }>('propose_transform', input);
    const file = memory.files.get(input.sources[0])!;
    memory.files.set(file.path, { ...file, modified: file.modified + 1 });
    await expect(allowed.requests.review(changed.id, true)).rejects.toThrow('source changed');
    expect(allowed.exportTransform).toHaveBeenCalledOnce();
    await expect(
      allowed.call('browser', { kind: 'state', id: 'private-browser' }),
    ).rejects.toThrow();
    // a nesting saves a folder of sheets, reviewed in the Layout plane only
    await expect(
      allowed.call('propose_transform', {
        ...input,
        name: 'Nesting.dxf',
        plan: {
          kind: 'nesting',
          format: 'dxf',
          title: 'Nesting of 1 part',
          sources: [{ units: 4, together: true, marks: [] }],
          parts: [
            { source: 0, index: 0, name: 'Part', quantity: 0, width: 10, height: 10, area: 100 },
          ],
          formats: [{ width: 1250, height: 2500, price: 0 }],
          sheets: [{ format: 0, placements: [] }],
          margin: 10,
          spacing: 5,
          cutting: {
            material: 'Mild steel',
            process: 'fiber',
            thickness: 3,
            speed: 3000,
            pierce: 0.5,
            density: 7.85,
            rate: 0,
            currency: 'EUR',
          },
        },
      }),
    ).rejects.toThrow('Layout plane');
    expect(allowed.exportTransform).toHaveBeenCalledOnce();
    expect(memory.remove).not.toHaveBeenCalled();
  });
  it('runs nothing on a renderer approval until the desktop confirmation is accepted', async () => {
    const f = await fixture();
    f.confirm.mockResolvedValueOnce(false);
    const proposal = await f.call<{ id: string }>('propose_command', { commandID: 'trash' });
    await expect(f.requests.review(proposal.id, true)).rejects.toThrow('not confirmed');
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.requests.get(proposal.id)?.status).toBe('review');
    expect(f.confirm.mock.calls[0][0]).toMatchObject({ removal: 'trash' });
    await f.requests.review(proposal.id, true);
    expect(f.execute).toHaveBeenCalledOnce();
  });
  it('fails closed when no desktop confirmation is available', async () => {
    const f = await fixture();
    const requests = new AgentRequests('/Memory/Viewer', f.settings, () => {}, f.execute, {
      read: () => ({ cwd: '/Granted', output: '' }),
    });
    const proposal = requests.configuration([{ path: 'settings.appearance', value: 'light' }]);
    await expect(requests.review(proposal.id, true)).rejects.toThrow('couldn’t ask you to confirm');
    expect(f.execute).not.toHaveBeenCalled();
  });
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
          version: sourceVersion(file),
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
  it('ignores valid saved execution grants even for custom aliases to Trash', async () => {
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
  it.each(['direct', 'alias', 'nested'] as const)(
    'rejects a %s Trash sequence through the broker and request service before any native prompt',
    async (kind) => {
      const f = await fixture();
      const removal = { ...action({ kind: 'builtin', command: 'trash' }), id: 'remove' };
      const nested = {
        ...action({ kind: 'sequence', commands: ['custom.remove'] }),
        id: 'inner',
      };
      f.config.customActions = [
        action({
          kind: 'sequence',
          commands: [
            'frame-all',
            kind === 'direct' ? 'trash' : kind === 'alias' ? 'custom.remove' : 'custom.inner',
          ],
        }),
        removal,
        nested,
      ];
      const catalog = await f.call<{ commands: CommandDescriptor[] }>('list_commands');
      expect(catalog.commands.some((command) => command.id === 'custom.cleanup')).toBe(false);
      for (const tool of ['explain_command', 'propose_command'])
        await expect(f.call(tool, { commandID: 'custom.cleanup' })).rejects.toThrow(
          'separate exact-path Trash proposal',
        );
      await expect(
        f.requests.command('custom.cleanup', f.target, 'Convenient action'),
      ).rejects.toThrow('separate exact-path Trash proposal');
      expect(f.requests.list()).toEqual([]);
      expect(f.confirm).not.toHaveBeenCalled();
      expect(f.execute).not.toHaveBeenCalled();
      expect(memory.remove).not.toHaveBeenCalled();
    },
  );
  it.each(['self', 'mutual', 'deep'] as const)(
    'rejects %s sequence recursion before a proposal, native prompt or executor can be reached',
    async (kind) => {
      const f = await fixture();
      if (kind === 'deep') {
        f.config.customActions = Array.from({ length: 12 }, (_, index) => ({
          ...action({
            kind: 'sequence',
            commands: [index === 11 ? 'frame-all' : `custom.step-${index + 1}`],
          }),
          id: index === 0 ? 'cleanup' : `step-${index}`,
        }));
      } else {
        f.config.customActions = [
          action({
            kind: 'sequence',
            commands: [kind === 'self' ? 'custom.cleanup' : 'custom.inner'],
          }),
          { ...action({ kind: 'sequence', commands: ['custom.cleanup'] }), id: 'inner' },
        ];
      }
      await expect(f.call('propose_command', { commandID: 'custom.cleanup' })).rejects.toThrow(
        /cycle|recursive|nested|deep/i,
      );
      await expect(
        f.requests.command('custom.cleanup', f.target, 'Convenient action'),
      ).rejects.toThrow(/cycle|recursive|nested|deep/i);
      expect(f.requests.list()).toEqual([]);
      expect(f.confirm).not.toHaveBeenCalled();
      expect(f.execute).not.toHaveBeenCalled();
    },
  );
  it('keeps nonremoving sequences under fresh review and direct aliases on the exact-path Trash route', async () => {
    const f = await fixture();
    f.config.customActions = [action({ kind: 'sequence', commands: ['frame-all', 'copy-path'] })];
    const safe = await f.call<{ id: string; requiresUserReview: boolean }>('propose_command', {
      commandID: 'custom.cleanup',
    });
    expect(safe.requiresUserReview).toBe(true);
    expect(f.requests.get(safe.id).status).toBe('review');
    expect(f.requests.get(safe.id).removal).toBeUndefined();
    f.config.customActions = [action({ kind: 'builtin', command: 'trash' })];
    const first = await f.call<{ id: string; requiresUserReview: boolean }>('propose_command', {
      commandID: 'custom.cleanup',
    });
    const second = await f.call<{ id: string; requiresUserReview: boolean }>('propose_command', {
      commandID: 'custom.cleanup',
    });
    expect(first.id).not.toBe(second.id);
    for (const request of [first, second]) {
      expect(request.requiresUserReview).toBe(true);
      expect(f.requests.get(request.id)).toMatchObject({
        status: 'review',
        removal: 'trash',
        target: { selection: f.target.selection },
      });
      expect(f.requests.get(request.id).detail).toContain('/Granted/Report.txt');
    }
    expect(f.confirm).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
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
  it('revokes a terminal-read grant through the linked folder it was granted for', async () => {
    const f = await fixture();
    memory.aliases.set('/Linked', '/Granted');
    await f.requests.grant('*', '/Linked', 'terminal-read', true);
    expect(await f.requests.listGrants()).toMatchObject([
      { root: '/Granted', chosen: '/Linked', capability: 'terminal-read' },
    ]);
    await f.requests.grant('*', '/Linked', 'terminal-read', false);
    expect(await f.requests.listGrants()).toEqual([]);
  });
  it('redacts terminal environment values and shell scripts from agent configuration reads', async () => {
    const f = await fixture();
    const settings = structuredClone(f.config);
    settings.terminals.profiles = [
      {
        id: 'shell',
        name: 'Shell',
        executable: '/bin/zsh',
        args: [],
        env: { API_TOKEN: 'secret' },
      },
    ];
    settings.customActions = [
      action({
        kind: 'shell',
        executable: '/bin/zsh',
        script: 'curl -H "token: secret"',
        perItem: false,
      }),
    ];
    const visible = JSON.stringify(redactedSettings(settings));
    expect(visible).not.toContain('secret');
    expect(visible).toContain('API_TOKEN');
  });
  it('hides the arguments of programs and terminal profiles too (2026-10-20)', async () => {
    // read_config returned them verbatim to any client with the metadata capability.
    const f = await fixture();
    const settings = structuredClone(f.config);
    settings.terminals.profiles = [
      {
        id: 'shell',
        name: 'Shell',
        executable: '/bin/zsh',
        args: ['-c', 'export T=SECRET'],
        env: {},
      },
    ];
    settings.customActions = [
      action({
        kind: 'executable',
        executable: '/usr/bin/tool',
        args: ['--token=SECRET', '{paths}'],
        perItem: false,
      }),
    ];
    const redacted = redactedSettings(settings);
    expect(JSON.stringify(redacted)).not.toContain('SECRET');
    expect(redacted.terminals.profiles[0]!.args).toHaveLength(2);
    const executor = redacted.customActions[0]!.executor;
    expect(executor.kind === 'executable' && executor.args).toHaveLength(2);
  });
  it('never shows agents the roots whose workspace offer the person dismissed', async () => {
    const f = await fixture();
    f.settings.snapshot().ui.insightsDismissed = {
      '/Home/code/acme-site': ['workspace.open'],
      '/Granted/Downloads': ['screenshots', 'workspace.open'],
    };
    const read = await f.call<{ ui: { insightsDismissed?: Record<string, string[]> } }>(
      'read_config',
    );
    expect(read.ui.insightsDismissed).toEqual({ '/Granted/Downloads': ['screenshots'] });
    expect(JSON.stringify(read)).not.toContain('acme-site');
    // a change preview names changed keys: never a root a dismissal names
    const preview = await f.call<{ changes: string[] }>('validate_config', {
      patches: [{ path: 'ui.insightsDismissed', value: {} }],
    });
    expect(JSON.stringify(preview)).not.toContain('acme-site');
    // nor can an agent show them again: Show Hidden Insights is the person's command
    expect(() => agentCommandID('show-hidden-insights', [])).toThrow('only to the person');
  });
  it('exposes only granted paths in read_config and validate_config while keeping non-path configuration', async () => {
    const f = await fixture(['/Granted']);
    const snapshot = f.settings.snapshot();
    snapshot.settings.browsing.newPlaneLocation = 'custom';
    snapshot.settings.browsing.newPlanePath = '/Outside/NewPlane';
    snapshot.settings.browsing.emptyWorkspaceLocation = 'custom';
    snapshot.settings.browsing.emptyWorkspacePath = '/Granted/Empty';
    snapshot.settings.folders = {
      '/Granted/Work': { mode: 'columns' },
      '/Outside/Private': { mode: 'grid' },
    };
    snapshot.settings.search = {
      roots: ['/Granted', '/Outside/SearchRoot'],
      contentRoots: ['/Granted/Docs', '/Outside/ContentRoot'],
      exclusions: ['node_modules', '/Outside/Library', '/Granted/Ignored'],
      paused: false,
    };
    snapshot.settings.agents.roots = ['/Granted', '/Outside/AgentRoot'];
    snapshot.settings.savedSearches = [
      { id: 'granted-search', name: 'Granted', query: 'invoice', root: '/Granted/Work' },
      { id: 'secret-search', name: 'Secret', query: 'payroll', root: '/Outside/Private' },
      { id: 'global-search', name: 'Global', query: 'todo' },
    ];
    snapshot.settings.customActions = [
      {
        ...action({ kind: 'builtin', command: 'copy-path' }),
        when: {
          target: 'any',
          extensions: [],
          min: 0,
          max: 10000,
          directories: ['/Granted/Work', '/Outside/Private'],
        },
      },
    ];
    snapshot.settings.terminals.application = '/Outside/CustomTerm.app';
    snapshot.settings.terminals.tmux.socket = '/Outside/tmux.sock';
    snapshot.settings.layouts = [
      {
        id: 'mixed',
        name: 'Mixed',
        layout: 'even-horizontal',
        main: 0.5,
        planes: [
          { kind: 'folder', path: '/Granted/Work' },
          { kind: 'folder', path: '/Outside/LayoutFolder' },
          { kind: 'scratch' },
        ],
      },
      {
        id: 'private-only',
        name: 'Private only',
        layout: 'even-horizontal',
        main: 0.5,
        planes: [{ kind: 'folder', path: '~/OutsideTilde' }],
      },
    ];
    snapshot.settings.profiles = [
      {
        id: 'desk',
        name: 'Desk',
        values: {
          'ui.space.grid': false,
          'ui.sidebar.locations': ['/Granted', '/Outside/ProfLoc'],
          'settings.browsing.newPlanePath': '/Outside/ProfPlane',
        },
      },
    ];
    snapshot.ui.sidebar.locations = ['/Granted', '/Outside/SidebarLoc'];
    snapshot.ui.sidebar.hidden = ['/Granted/Hidden', '/Outside/Hidden'];
    snapshot.ui.sidebar.labels = { '/Granted': 'Work', '/Outside/SidebarLoc': 'Secret' };
    snapshot.ui.insightsDismissed = {
      '/Granted/Work': ['screenshots', 'workspace.open'],
      '/Outside/Private': ['screenshots'],
    };

    const read = await f.call<{
      settings: typeof snapshot.settings;
      ui: typeof snapshot.ui;
    }>('read_config');
    const serialized = JSON.stringify(read);
    expect(serialized).not.toContain('/Outside');
    expect(serialized).not.toContain('OutsideTilde');
    expect(serialized).not.toContain('payroll');
    expect(serialized).not.toContain('CustomTerm');
    expect(serialized).not.toContain('tmux.sock');
    expect(read.settings.appearance).toBe(snapshot.settings.appearance);
    expect(read.settings.browsing.newPlanePath).toBe('');
    expect(read.settings.browsing.emptyWorkspacePath).toBe('/Granted/Empty');
    expect(read.settings.folders).toEqual({ '/Granted/Work': { mode: 'columns' } });
    expect(read.settings.search.roots).toEqual(['/Granted']);
    expect(read.settings.search.contentRoots).toEqual(['/Granted/Docs']);
    expect(read.settings.search.exclusions).toEqual(['node_modules', '/Granted/Ignored']);
    expect(read.settings.agents.roots).toEqual(['/Granted']);
    expect(read.settings.savedSearches.map((item) => item.id)).toEqual([
      'granted-search',
      'global-search',
    ]);
    expect(read.settings.customActions[0]!.when.directories).toEqual(['/Granted/Work']);
    expect(read.settings.terminals.application).toBe('');
    expect(read.settings.terminals.tmux.socket).toBe('');
    expect(read.settings.layouts).toEqual([
      {
        id: 'mixed',
        name: 'Mixed',
        layout: 'even-horizontal',
        main: 0.5,
        planes: [{ kind: 'folder', path: '/Granted/Work' }, { kind: 'scratch' }],
      },
    ]);
    expect(read.settings.profiles[0]!.values).toEqual({
      'ui.space.grid': false,
      'ui.sidebar.locations': ['/Granted'],
      'settings.browsing.newPlanePath': '',
    });
    expect(read.ui.sidebar.locations).toEqual(['/Granted']);
    expect(read.ui.sidebar.hidden).toEqual(['/Granted/Hidden']);
    expect(read.ui.sidebar.labels).toEqual({ '/Granted': 'Work' });
    expect(read.ui.insightsDismissed).toEqual({ '/Granted/Work': ['screenshots'] });

    // validate_config must never leak ungranted paths in diff keys or via existence/value oracles.
    const clearFolders = await f.call<{ valid: true; changes: string[] }>('validate_config', {
      patches: [{ path: 'settings.folders', value: {} }],
    });
    expect(clearFolders.changes).toEqual(['settings.folders./Granted/Work']);
    expect(JSON.stringify(clearFolders)).not.toContain('/Outside');

    const clearLabels = await f.call<{ valid: true; changes: string[] }>('validate_config', {
      patches: [{ path: 'ui.sidebar.labels', value: {} }],
    });
    expect(clearLabels.changes).toEqual(['ui.sidebar.labels./Granted']);

    const appearance = await f.call<{ valid: true; changes: string[] }>('validate_config', {
      patches: [{ path: 'settings.appearance', value: 'light' }],
    });
    expect(appearance).toEqual({ valid: true, changes: ['settings.appearance'] });

    const sidebarProbe = await f.call<{ valid: true; changes: string[] }>('validate_config', {
      patches: [{ path: 'ui.sidebar.locations', value: ['/Granted', '/Outside/SidebarLoc'] }],
    });
    expect(sidebarProbe.changes).toEqual(['ui.sidebar.locations']);

    await expect(
      f.call('validate_config', {
        patches: [
          {
            path: 'ui.sidebar.labels',
            keys: ['ui', 'sidebar', 'labels', '/Outside/SidebarLoc'],
            value: undefined,
          },
        ],
      }),
    ).rejects.toThrow('Unknown setting.');
  });
  it('keeps Empty Trash unreachable from agent tools, CLI verbs, workflow steps and custom actions', async () => {
    const f = await fixture();
    // 1. Agent tools: no empty-trash tool exists and direct calls fail.
    expect(
      agentTools.some((tool) => /empty.?trash|trash.?empty|trash.?confirm/i.test(tool.name)),
    ).toBe(false);
    for (const tool of ['empty_trash', 'empty-trash', 'trash_empty', 'trashConfirmation'])
      await expect(f.call(tool)).rejects.toThrow();

    // 2. CLI verbs and command-line verbs: no verb targets emptying Trash.
    expect(
      cliCommands.some(
        (command) =>
          command.name.some((part) => /empty|trash/i.test(part)) ||
          /empty|trash/i.test(command.tool ?? ''),
      ),
    ).toBe(false);
    expect(verbs.some((verb) => verb.names.some((name) => /empty/i.test(name)))).toBe(false);

    for (const command of forbiddenTrashCommands) {
      let output = '';
      const sink = new Writable({
        write(chunk, _encoding, done) {
          output += String(chunk);
          done();
        },
      });
      const code = await runCLI(['command', 'run', command], {
        dataPath: '/Memory/Viewer',
        version: 'test',
        cwd: '/Granted',
        home: '/Home',
        input: Readable.from([]),
        output: sink,
        error: sink,
        call: (method, params, signal) =>
          f.broker.handle(f.created.token, { method, params }, signal),
      });
      expect(code).not.toBe(0);
      expect(output).toBeTruthy();

      // 3. Custom actions: builtin, sequence, nested sequence and model line reject every forbidden command.
      const builtin = action({ kind: 'builtin', command });
      const seq = action({ kind: 'sequence', commands: [command] });
      const nested = [
        action({ kind: 'sequence', commands: ['custom.inner'] }),
        { ...action({ kind: 'builtin', command }), id: 'inner' },
      ];
      expect(() => agentCommandID(command, [])).toThrow('native user interface');
      expect(() => agentCommandID('custom.cleanup', [builtin])).toThrow('native user interface');
      expect(() => agentCommandID('custom.cleanup', [seq])).toThrow('native user interface');
      expect(() => agentCommandID('custom.cleanup', nested)).toThrow('native user interface');
      expect(modelLineCommandProblem(command, [])).toBeDefined();
      expect(modelLineCommandProblem('custom.cleanup', [builtin])).toBeDefined();
      expect(modelLineCommandProblem('custom.cleanup', [seq])).toBeDefined();
      f.config.customActions = [builtin];
      await expect(f.call('propose_command', { commandID: 'custom.cleanup' })).rejects.toThrow(
        'native user interface',
      );
    }

    // 4. Workflow steps: workflow schema accepts only inspect, compare, recipe, copy and convert.
    for (const kind of ['empty-trash', 'trash', 'delete', 'command', 'shell']) {
      expect(
        workflowDefinitionSchema.safeParse({
          version: 1,
          id: 'unsafe',
          name: 'Unsafe',
          bindings: [],
          inputs: {},
          steps: [{ id: 'step', kind, sources: [{ kind: 'selection' }] }],
        }).success,
      ).toBe(false);
    }
    expect(f.execute).not.toHaveBeenCalled();
    await f.broker.close();
  });
  it('allows only bounded built-in commands and refuses clipboard paste', () => {
    for (const id of ['trash', 'copy-path', 'view-list', 'recipe.books', 'rename'])
      expect(agentCommandID(id, [])).toBe(id);
    for (const id of ['paste', 'paste-move'])
      expect(() => agentCommandID(id, [])).toThrow('clipboard');
    for (const id of ['delete-workspace', 'restore', 'share', 'volumes', 'cut', 'open-config'])
      expect(() => agentCommandID(id, []), id).toThrow('Agents cannot propose');
    expect(agentCommandID('custom.cleanup', [action({ kind: 'recipe', recipeID: 'books' })])).toBe(
      'custom.cleanup',
    );
    expect(() =>
      agentCommandID('custom.cleanup', [action({ kind: 'builtin', command: 'paste' })]),
    ).toThrow('clipboard');
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

describe('an agent command as the workspace receives it (2026-10-20)', () => {
  const custom = (executor: CustomAction['executor']) =>
    ({
      id: 'tidy',
      name: 'Tidy',
      aliases: [],
      icon: 'command',
      shortcut: '',
      order: 0,
      pinned: false,
      when: { target: 'any', extensions: [], min: 0, max: 10000 },
      executor,
    }) as CustomAction;
  const reviewed = { kind: 'recipe', recipeID: 'rename' } as const;
  it('is refused once main has stopped waiting for it', () => {
    // A hidden window ran it later, after the agent had been told it failed.
    expect(agentDispatchRefusal({ command: 'copy-path', deadline: 1000 }, [], 2000)).toMatch(
      'expired',
    );
    expect(
      agentDispatchRefusal({ command: 'copy-path', deadline: 3000 }, [], 2000),
    ).toBeUndefined();
  });
  it('runs a custom action only as it was reviewed', () => {
    // The workspace ran its current definition: a recipe action changed into a shell script ran.
    const event = { command: 'custom.tidy', deadline: 3000, executor: reviewed };
    expect(agentDispatchRefusal(event, [custom(reviewed)], 2000)).toBeUndefined();
    expect(
      agentDispatchRefusal(
        event,
        [custom({ kind: 'shell', executable: '/bin/zsh', script: 'pwd', perItem: false })],
        2000,
      ),
    ).toMatch('changed after it was reviewed');
    expect(
      agentDispatchRefusal({ ...event, executor: undefined }, [custom(reviewed)], 2000),
    ).toMatch('changed after it was reviewed');
  });
});

describe('recipe bindings an agent cannot change (2026-10-20)', () => {
  it('refuses a proposal that changes a recipe’s shortcut, provider or raises its data', async () => {
    // A whole-recipes patch carried them, and the person saw only JSON in the confirmation.
    const service = new SettingsService(
      '/Memory/Viewer',
      '/Home',
      () => true,
      () => {},
    );
    const recipes = service.snapshot().settings.recipes;
    const change = (edit: Partial<(typeof recipes)[number]>) =>
      service.preview([
        {
          path: 'settings.recipes',
          value: recipes.map((recipe, index) => (index ? recipe : { ...recipe, ...edit })),
        },
      ]);
    expect(() => change({ shortcut: 'Cmd+Alt+R' })).toThrow('stay with you');
    expect(() => change({ providerID: 'elsewhere' })).toThrow('stay with you');
    if (recipes[0]!.data !== 'full-text')
      expect(() => change({ data: 'full-text' })).toThrow('stay with you');
    expect(change({ name: 'Renamed by agent' }).valid).toBe(true);
  });
});

describe('synthetic captured agent selections', () => {
  it.each(['command', 'selection'] as const)(
    'keeps %s review guarded across synthetic inode changes',
    async (flow) => {
      const f = await fixture(['/Granted'], false, flow === 'selection');
      const captured = { ...item(), identity: itemIdentity({ dev: 1n, ino: -1n }) };
      f.target.selection = [captured];
      memory.files.set(captured.path, {
        ...captured,
        identity: itemIdentity({ dev: 1n, ino: -2n }),
      });
      const prepare = () =>
        flow === 'command'
          ? f.call<{ id: string }>('propose_command', { commandID: 'trash' })
          : f.broker.clients.context.run(f.created.client.id, () =>
              f.requests.navigation({ kind: 'select-files', files: [captured] }, f.target),
            );
      const proposal = await prepare();
      memory.files.set(captured.path, {
        ...captured,
        identity: itemIdentity({ dev: 1n, ino: -3n }),
      });
      await f.requests.review(proposal.id, true);
      const dispatched = flow === 'command' ? f.execute : f.navigate;
      expect(dispatched).toHaveBeenCalledOnce();
      expect(memory.remove).not.toHaveBeenCalled();
      const another = await prepare();
      dispatched.mockClear();
      memory.files.set(captured.path, {
        ...captured,
        identity: itemIdentity({ dev: 1n, ino: -4n }),
        created: captured.created + 1,
      });
      await expect(f.requests.review(another.id, true)).rejects.toThrow('Selection changed');
      expect(dispatched).not.toHaveBeenCalled();
    },
  );
  it('enforces the recipe task budget on the shared connection too', async () => {
    const f = await fixture(['/Granted'], false);
    const sharedToken = await f.broker.credential();
    const sharedTasks = Array.from({ length: 20 }, (_, index) => ({
      id: `task-${index}`,
      status: 'review',
      context: { actor: 'agent', clientID: 'shared', sources: ['/Granted/Report.txt'] },
    }));
    const broker = new AgentBroker(
      '/Memory/Viewer',
      () => f.config,
      () => ({
        workspaceID: 'workspace',
        paneID: 'folder',
        rootID: 'root',
        actor: 'user',
        sources: ['/Granted/Report.txt'],
      }),
      {} as unknown as FileServices,
      {
        all: async () => sharedTasks,
        start: vi.fn(async () => 'task-21'),
        cancel: vi.fn(),
      } as unknown as ActionPlanner,
      {
        catalog: () => ({ target: f.target, commands: [] }),
        requests: f.requests,
        config: f.settings,
      },
    );
    const change = {
      enabled: true,
      add: ['/Granted'],
      capabilities: ['metadata' as const, 'propose' as const],
    };
    const review = await broker.access.captureReview(change);
    await broker.access.approve(change, review);
    const token = await broker.credential();
    expect(token).not.toBe(sharedToken);
    await expect(
      broker.handle(token, {
        method: 'tools/call',
        params: {
          name: 'run_action',
          arguments: { recipeID: 'batch-rename', sources: ['/Granted/Report.txt'] },
        },
      }),
    ).rejects.toThrow('Review or stop a task before starting another.');
    await broker.close();
  });
});
