import * as fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapturedTarget, TerminalStart } from '../src/domain/automation/actions';
import type { OperationRequest } from '../src/domain/contracts';
import type { GitTargetWindow } from '../src/desktop/comparison/git-target';
import { defaultSettings } from '../src/domain/services';
import { temporalIdentity } from '../src/domain/files/item-identity';
import { FileAccess } from '../src/desktop/files/file-access';
import { absolute, entry, list } from '../src/desktop/files/filesystem';
import { lstat, stat } from '../src/desktop/files/stats';
import { FileCoordination } from '../src/desktop/files/file-coordination';
import { FileServices } from '../src/desktop/files/file-services';
import { Watchers } from '../src/desktop/files/watchers';
import { Search } from '../src/desktop/search/search';
import { Resources } from '../src/desktop/previews/resources';
import { PreviewScope, PreviewWork } from '../src/desktop/previews/preview-work';
import { Thumbnails } from '../src/desktop/previews/thumbnails';
import { Terminals } from '../src/desktop/terminals/terminals';
import { Operations } from '../src/desktop/operations/operations';
import { validateManualTarget } from '../src/desktop/actions/manual-target';
import { validateGitTarget } from '../src/desktop/comparison/git-target';
import { DefinitionCommands } from '../src/desktop/workspaces/definition-commands';
import { createTerminalHandlers } from '../src/desktop/ipc/terminal-handlers';
import { createPasteboardHandlers } from '../src/desktop/ipc/pasteboard-handlers';
import * as filesystem from '../src/desktop/files/filesystem';
import type { DefinitionCommandStart } from '../src/domain/terminals/definition-commands';
import { GitReader } from '../src/desktop/comparison/git';

const calls = vi.hoisted(() => ({
  filesystem: vi.fn(),
  native: vi.fn(),
  worker: vi.fn(),
  process: vi.fn(),
}));

vi.mock('node:fs/promises', async (original) => {
  const module = await original<typeof fs>();
  const methods = Object.fromEntries(
    Object.entries(module)
      .filter(([name, value]) => name !== 'default' && typeof value === 'function')
      .map(([name]) => [
        name,
        (...args: unknown[]) => {
          calls.filesystem(name, ...args);
          throw new Error('Unexpected local filesystem access.');
        },
      ]),
  );
  return { ...module, ...methods, default: { ...module, ...methods } };
});
vi.mock('electron', () => ({ nativeImage: {}, utilityProcess: { fork: calls.worker } }));
vi.mock('../src/desktop/files/directory-watch', () => ({ watchDirectory: calls.native }));
vi.mock('../src/desktop/native/macos-files', () => ({ macFiles: calls.native }));
vi.mock('../src/desktop/workers/utility-client', () => ({
  launchWorker: calls.worker,
  UtilityClient: class {
    call = calls.worker;
    post = calls.worker;
    close = async () => {};
  },
}));

const remoteInputs = [
  'viewer-sftp://server01/srv/Project',
  'viewer-sftp://server01/',
  'viewer-sftp://server01/srv/../Project',
  'viewer-sftp://server01/srv//Project',
  'viewer-sftp://invalid-id/path',
  'viewer-sftp:/server01/path',
  'viewer-sftp:',
  'VIEWER-SFTP://server01/path',
];
const refusal = { code: 'VIEWER_REMOTE_NOT_LOCAL' };
const noop = async () => {};
const terminal = (cwd: string): TerminalStart => ({
  id: 'terminal',
  workspaceID: 'workspace',
  rootID: 'pane',
  cwd,
  profileID: 'login',
  cols: 80,
  rows: 24,
});
const terminals = () =>
  new Terminals('/fixtures/worker.cjs', () => defaultSettings('/fixtures'), vi.fn());
const operations = () => new Operations(noop, vi.fn());
const refused = (work: () => unknown) =>
  expect(Promise.resolve().then(work)).rejects.toMatchObject(refusal);

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  expect(calls.filesystem).not.toHaveBeenCalled();
  expect(calls.native).not.toHaveBeenCalled();
  expect(calls.worker).not.toHaveBeenCalled();
  expect(calls.process).not.toHaveBeenCalled();
});

describe.each(remoteInputs)('local desktop refusal of %s', (file) => {
  it('rejects direct-build and scoped file permission before canonical lookup or native grants', async () => {
    const native = { start: calls.native };
    for (const access of [
      new FileAccess('/fixtures/private'),
      new FileAccess('/fixtures/private', native),
    ]) {
      await refused(() => access.require(['/fixtures/local', file]));
      await refused(() => access.remember(file, true, 'bookmark'));
      await refused(() => access.allowOnce(file, 'bookmark'));
      await refused(() =>
        access.receiveNative([{ path: file, directory: true, bookmark: 'bookmark' }]),
      );
      await refused(() =>
        access.withReceipt({ path: file, directory: true, bookmark: 'bookmark' }, noop),
      );
      await refused(() => access.withBlocked(file, noop));
      await refused(() => access.revoke(file, noop));
      await refused(() => access.historyScope(file));
      await refused(() => access.historyScopeRoot(file));
      await access.close();
    }
  });

  it('rejects folder watching and local search before watcher or filesystem work', async () => {
    const watchers = new Watchers(vi.fn());
    await refused(() => watchers.add(file, 'plane'));
    expect(watchers.count).toBe(0);
    const search = new Search(vi.fn(), null);
    await refused(() => search.start({ id: 'search', root: file, query: '', showHidden: false }));
    await search.close();
    await watchers.close();
  });

  it('rejects default preview and thumbnail services without relying on an access callback', async () => {
    const resources = new Resources();
    await refused(() => resources.grant(file));
    await refused(() => resources.grantBytes(file, 'saved.txt', Buffer.from('saved bytes')));
    await refused(() => new Thumbnails().get(file, 128));
    await resources.close();
  });

  it('rejects terminal start, status and Git launch before local lookup or a worker start', async () => {
    const service = terminals();
    await refused(() => service.start(terminal(file), 7));
    await refused(() => service.running(terminal(file), 7));
    await refused(() => service.status(terminal(file), 7));
    await refused(() =>
      service.startGit(
        {
          kind: 'status',
          request: terminal(file),
          executable: '/usr/bin/git',
          args: [],
          env: {},
          outputLimit: 1024,
          timeoutMs: 1000,
          signal: new AbortController().signal,
        },
        7,
      ),
    );
    await refused(() =>
      service.runCommand(
        {
          id: 'command',
          owner: 7,
          workspaceID: 'workspace',
          rootID: 'pane',
          cwd: file,
          executable: '/bin/sh',
          args: [],
          env: {},
        },
        new AbortController().signal,
        vi.fn(),
      ),
    );
    await service.close();
  });

  it('rejects local operation sources, destinations and reviewed paths before queueing', async () => {
    const service = operations();
    const requests: OperationRequest[] = [
      { kind: 'trash', sources: [file] },
      { kind: 'copy', sources: ['/fixtures/local'], destination: file },
      { kind: 'copy', sources: [file], destination: '/fixtures/local' },
      { kind: 'mkdir', sources: [], destination: file, name: 'New folder' },
      {
        kind: 'trash',
        sources: ['/fixtures/local'],
        expectedSources: [
          { path: file, version: { identity: temporalIdentity('pin'), modified: 0, size: 0 } },
        ],
      },
      {
        kind: 'trash',
        sources: ['/fixtures/local'],
        expectedContents: [{ path: file, proof: 'proof' }],
      },
      {
        kind: 'copy',
        sources: ['/fixtures/local'],
        destination: '/fixtures/output',
        reviewedDestination: { path: file, identity: 'pin' },
      },
      {
        kind: 'convert',
        sources: ['/fixtures/local'],
        preparedTransforms: [{ path: file, id: 'prepared' }],
      },
    ];
    for (const request of requests) {
      await refused(() => service.start(request));
      await refused(() => service.start(request, 'agent'));
    }
    await refused(() => service.writeText(file, 'text'));
    expect(service.all()).toEqual([]);
    await service.close();
  });

  it('rejects filesystem and coordination wrappers before platform fallbacks', async () => {
    for (const work of [
      () => absolute(file),
      () => entry(file),
      () => list(file),
      () => lstat(file),
      () => stat(file),
    ])
      await refused(work);
    const coordination = new FileCoordination(undefined);
    await refused(() => coordination.path(file));
    await refused(() => coordination.run([{ path: file, mode: 'read' }], noop));
    await refused(() => coordination.quiesce(file));
    await coordination.close();
  });

  it('rejects preview scope inputs and invalidation before resolve or realpath', async () => {
    await refused(() => new PreviewScope([file]));
    const scope = new PreviewScope(['/fixtures/local']);
    await refused(() => scope.add(file));
    await refused(() => scope.invalidate(file));
    const work = new PreviewWork();
    await refused(() => work.track([file], async () => 'bytes'));
    await refused(() => work.invalidate(file));
    work.stop();
  });

  it('rejects file worker dispatch with its default optional access callback', async () => {
    const files = new FileServices(
      '/fixtures/private',
      '/fixtures/worker',
      '/fixtures/ocr',
      vi.fn(),
    );
    for (const work of [
      () => files.configure({ ...defaultSettings('/fixtures').search, roots: [file] }),
      () => files.configure({ ...defaultSettings('/fixtures').search, contentRoots: [file] }),
      () => files.query({ root: file, query: 'name' }),
      () => files.snapshot({ root: file, query: 'name' }),
      () => files.sizeStart([file]),
      () => files.update(file),
      () => files.extract(file),
      () => files.page(file, 'html'),
      () => files.sqlite(file, { kind: 'tables' }),
      () => files.inspect(file),
      () => files.drawingGeometry(file),
    ])
      await refused(work);
    await files.close();
  });

  it('rejects Git read routes before canonicalization or process execution', async () => {
    const reader = new GitReader(() => true, noop, calls.process);
    for (const work of [
      () => reader.root(file),
      () => reader.status(file),
      () => reader.worktrees(file),
      () => reader.head(file),
      () => reader.localBranches(file),
      () => reader.diff(file, 'HEAD', new AbortController().signal),
      () =>
        reader.blob({ kind: 'git', repository: file, path: 'file.txt', commit: 'a'.repeat(40) }),
    ])
      await refused(work);
    reader.close();
  });
});

function context(type: 'folder' | 'terminal' | 'preview') {
  const target: CapturedTarget = {
    originID: 'origin',
    workspaceID: 'workspace',
    rootID: 'pane',
    paneID: 'pane',
    panePath: '/fixtures/local',
    directory: '/fixtures/local',
    selection: [],
  };
  const window: GitTargetWindow = {
    originID: 'origin',
    workspaceID: 'workspace',
    alive: true,
    workspaces: {
      activeWorkspace: 'workspace',
      workspaces: [
        {
          id: 'workspace',
          name: 'Workspace',
          roots: ['pane'],
          panes: [{ id: 'pane', type, path: '/fixtures/local' }],
        },
      ],
    },
  };
  return { target, window };
}

describe('restored local command contexts', () => {
  it.each(['folder', 'terminal', 'preview'] as const)(
    'rejects a restored remote %s path before dirname',
    async (type) => {
      for (const file of remoteInputs) {
        const { target, window } = context(type);
        window.workspaces!.workspaces[0]!.panes[0]!.path = file;
        await refused(() => validateManualTarget(target, window, '/fixtures/home'));
        await refused(() =>
          validateGitTarget(target, window, undefined, ['folder', 'terminal', 'preview']),
        );
      }
    },
  );

  it('checks every selected path before canonicalizing any local path', async () => {
    for (const file of remoteInputs) {
      const { target, window } = context('folder');
      target.selection = [{ path: file } as CapturedTarget['selection'][number]];
      await refused(() => validateManualTarget(target, window, '/fixtures/home'));
      await refused(() => validateGitTarget(target, window));
      target.selection = [];
      target.directory = file;
      await refused(() => validateManualTarget(target, window, '/fixtures/home'));
      await refused(() => validateGitTarget(target, window));
    }
  });
});

describe('restored operation and terminal internals', () => {
  it('validates every Undo path before reading any local step', async () => {
    for (const file of remoteInputs) {
      for (const remoteField of ['from', 'to'] as const) {
        const service = operations();
        const tasks = Reflect.get(service, 'tasks') as Map<string, unknown>;
        const localStep = {
          from: '/fixtures/output',
          to: '/fixtures/original',
          identity: 'pin',
          modified: 0,
          size: 0,
        };
        tasks.set('restore', {
          job: { id: 'restore', kind: 'copy', status: 'completed', undoable: true },
          request: { kind: 'copy', sources: ['/fixtures/original'], destination: '/fixtures' },
          undo: [localStep, { ...localStep, [remoteField]: file }],
          abort: new AbortController(),
        });
        await refused(() => service.undo('restore'));
        await service.close();
      }
    }
  });

  it('guards the local item execution seam even if a future caller bypasses start', async () => {
    const service = operations();
    const runItem = Reflect.get(service, 'runItem') as (
      task: unknown,
      source: string,
    ) => Promise<unknown>;
    for (const file of remoteInputs) {
      await refused(() =>
        runItem.call(
          service,
          { request: { kind: 'copy', sources: [file], destination: '/fixtures' } },
          file,
        ),
      );
      await refused(() =>
        runItem.call(service, { request: { kind: 'mkdir', sources: [], destination: file } }, ''),
      );
    }
    await service.close();
  });

  it('guards the exact-cwd terminal match before its reattachment early return', async () => {
    const service = terminals();
    const match = Reflect.get(service, 'match') as (
      request: TerminalStart,
      owner: number,
      existing: unknown,
    ) => Promise<void>;
    for (const file of remoteInputs) {
      const request = terminal(file);
      await refused(() => match.call(service, request, 7, { owner: 7, request }));
    }
    await service.close();
  });
});

describe('reviewed refusal before observable work', () => {
  const file = remoteInputs[0]!;
  it('validates absolute local paths even in the direct build', async () => {
    const access = new FileAccess('/fixtures/private');
    for (const invalid of [
      ' ' + file,
      '\t' + file,
      '\ufeff' + file,
      'viewer\u2011sftp://server01/srv/Project',
      'relative/folder',
      '/a\0b',
    ])
      await expect(access.require([invalid])).rejects.toThrow();
    await access.require(['/fixtures/local']);
    await access.close();
  });
  it('refuses a paste destination before reading the native clipboard', async () => {
    const readForPaste = vi.fn(async () => null);
    const handlers = createPasteboardHandlers({
      pasteboard: { readForPaste },
    } as unknown as Parameters<typeof createPasteboardHandlers>[0]);
    await refused(() => handlers.clipboardPaste([file], 7));
    for (const invalid of [
      ' ' + file,
      String.fromCharCode(9) + file,
      String.fromCharCode(0xfeff) + file,
      'viewer' + String.fromCodePoint(0x2011) + 'sftp://server01/path',
      'relative/folder',
    ])
      await expect(
        Promise.resolve().then(() => handlers.clipboardPaste([invalid], 7)),
      ).rejects.toThrow();
    expect(readForPaste).not.toHaveBeenCalled();
  });
  it('refuses watching before invoking the deeper absolute-path boundary', async () => {
    const absolute = vi.spyOn(filesystem, 'absolute');
    try {
      const watchers = new Watchers(vi.fn());
      await refused(() => watchers.add(file, 'plane'));
      expect(absolute).not.toHaveBeenCalled();
      expect(watchers.count).toBe(0);
      await watchers.close();
    } finally {
      absolute.mockRestore();
    }
  });
  it('keeps a running search and its ownership untouched', async () => {
    const search = new Search(vi.fn(), null);
    const requests = Reflect.get(search, 'requests') as Map<string, AbortController>;
    const current = new AbortController();
    requests.set('search', current);
    const set = vi.spyOn(requests, 'set');
    await refused(() => search.start({ id: 'search', root: file, query: '', showHidden: false }));
    expect(current.signal.aborted).toBe(false);
    expect(requests.get('search')).toBe(current);
    expect(set).not.toHaveBeenCalled();
    requests.clear();
    await search.close();
  });
  it('refuses the local grant seam before scope checks or authorization', async () => {
    const access = vi.fn(noop);
    const resources = new Resources(access);
    const scope = new PreviewScope([]);
    const check = vi.spyOn(scope, 'check');
    const grant = Reflect.get(resources, 'grantFile') as (
      file: string,
      scope: PreviewScope,
    ) => Promise<unknown>;
    await refused(() => grant.call(resources, file, scope));
    expect(access).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
    await resources.close();
  });
  it('refuses thumbnails before lifecycle tracking and closed-service fallbacks', async () => {
    const thumbnails = new Thumbnails();
    const work = Reflect.get(thumbnails, 'work') as PreviewWork;
    const track = vi.spyOn(work, 'track');
    await refused(() => thumbnails.get(file, 128));
    expect(track).not.toHaveBeenCalled();
    Reflect.set(thumbnails, 'closed', true);
    await refused(() => thumbnails.get(file, 128));
  });
  it('keeps terminal pending ownership untouched before local preparation', async () => {
    const service = terminals();
    const pending = Reflect.get(service, 'pending') as Map<string, unknown>;
    const set = vi.spyOn(pending, 'set');
    await refused(() => service.start(terminal(file), 7));
    expect(set).not.toHaveBeenCalled();
    expect(pending.size).toBe(0);
    await service.close();
  });
  it('refuses local terminal preparation before acquiring access', async () => {
    const access = vi.fn(noop);
    const service = new Terminals(
      '/fixtures/worker',
      () => defaultSettings('/fixtures'),
      vi.fn(),
      access,
    );
    const prepare = Reflect.get(service, 'prepare') as (
      request: TerminalStart,
      owner: number,
      options: object,
    ) => Promise<void>;
    await refused(() => prepare.call(service, terminal(file), 7, {}));
    expect(access).not.toHaveBeenCalled();
    await service.close();
  });
  it('refuses remote executables in a local command before dispatch', async () => {
    const service = terminals();
    for (const executable of remoteInputs)
      await refused(() =>
        service.runCommand(
          {
            id: 'command',
            owner: 7,
            workspaceID: 'workspace',
            rootID: 'pane',
            cwd: '/fixtures/local',
            executable,
            args: [],
            env: {},
          },
          new AbortController().signal,
          vi.fn(),
        ),
      );
    expect(Reflect.get(service, 'commands').size).toBe(0);
    await service.close();
  });
  it.each(['expectedSources', 'reviewedDestination'] as const)(
    'preserves Redo before rejecting %s',
    async (field) => {
      const service = operations();
      const owner = service as unknown as { endRedo(): void };
      const endRedo = vi.spyOn(owner, 'endRedo');
      const request: OperationRequest = {
        kind: 'copy',
        sources: ['/fixtures/local'],
        destination: '/fixtures/output',
      };
      if (field === 'expectedSources')
        request.expectedSources = [
          { path: file, version: { identity: temporalIdentity('pin'), modified: 0, size: 0 } },
        ];
      else request.reviewedDestination = { path: file, identity: 'pin' };
      await refused(() => service.start(request));
      expect(endRedo).not.toHaveBeenCalled();
      expect(service.all()).toEqual([]);
      await service.close();
    },
  );
  it('preserves index revision and configuration queue before refusal', async () => {
    const files = new FileServices(
      '/fixtures/private',
      '/fixtures/worker',
      '/fixtures/ocr',
      vi.fn(),
    );
    const revision = Reflect.get(files, 'revision');
    const queue = Reflect.get(files, 'configurations');
    await refused(() => files.configure({ ...defaultSettings('/fixtures').search, roots: [file] }));
    expect(Reflect.get(files, 'revision')).toBe(revision);
    expect(Reflect.get(files, 'configurations')).toBe(queue);
    await files.close();
  });
});

describe('definition command remote refusal', () => {
  it('guards every terminal definition route and every batch item before work', async () => {
    const lookup = vi.fn();
    const commands = new DefinitionCommands({
      lookup,
      terminals: { start: vi.fn(), running: vi.fn(), profile: vi.fn() },
      confirmations: { requireDefinitionCommands: vi.fn() },
      ownsWorkspace: () => true,
      isAgentDriven: () => false,
      window: () => undefined,
    });
    const handlers = createTerminalHandlers({
      definitionCommands: commands,
      terminals: { status: vi.fn() },
    } as unknown as Parameters<typeof createTerminalHandlers>[0]);
    const reference = { key: 'work', plane: 0, basis: 'basis' };
    for (const cwd of remoteInputs) {
      const request = terminal(cwd);
      await refused(() => handlers.terminalStart([request, reference], 7));
      await refused(() => handlers.terminalDefinitionCommand([request, reference], 7));
      await refused(() => handlers.terminalStatus([request, false], 7));
      const items: DefinitionCommandStart[] = [
        { ...reference, request: { ...terminal('/fixtures/local'), id: 'local' } },
        { ...reference, plane: 1, request },
      ];
      await refused(() => handlers.terminalStartAll([items], 7));
      expect((Reflect.get(commands, 'starts') as Map<string, unknown>).size).toBe(0);
    }
    expect(lookup).not.toHaveBeenCalled();
  });
});
