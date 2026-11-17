import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { createDefinitionHandlers } from '../src/desktop/ipc/definition-handlers';
import { WorkspaceSessions } from '../src/desktop/windows/workspace-sessions';
import type { WorkspaceDefinitions } from '../src/desktop/workspaces/definitions';
import type { DefinedWorkspaces } from '../src/desktop/workspaces/defined-workspaces';
import { sampleDefinition, sampleWorkspace } from './workspace-definition-fixtures';

const native = vi.hoisted(() => ({
  open: vi.fn(async () => ''),
  choose: vi.fn(async () => undefined),
}));
vi.mock('electron', () => ({ shell: { openPath: native.open } }));
vi.mock('../src/desktop/native/dialogs', () => ({ chooseRemembered: native.choose }));
afterEach(() => vi.restoreAllMocks());

function fixture() {
  const sessions = new WorkspaceSessions();
  const first = sessions.create('/home/sample', 'First');
  const second = sessions.create('/home/sample', 'Second');
  const a = sessions.open(1, '/home/sample', first);
  const b = sessions.open(2, '/home/sample', second);
  const definition = sampleDefinition();
  const catalog = {
    revision: 1,
    file: { path: '/data/workspaces.jsonc', state: 'read' as const },
    projectManager: {
      path: '/source/projects.json',
      state: 'read' as const,
      projects: 1,
      missing: 0,
      disabled: 0,
      remote: 0,
      duplicateKeys: 0,
    },
    definitions: [definition],
    diagnostics: [],
  };
  const definitions = {
    load: vi.fn(async () => {}),
    snapshot: () => structuredClone(catalog),
    entry: vi.fn((key: string) => (key === definition.key ? definition : undefined)),
    opened: vi.fn(async () => {}),
    checkRoot: vi.fn(async () => 'present' as const),
    searchRoots: vi.fn(),
    save: vi.fn<WorkspaceDefinitions['save']>(async () => ({
      kind: 'saved' as const,
      key: definition.key,
      basis: definition.basis,
      planes: {},
      commandPlanes: [],
      skipped: [],
      literalPaths: [],
    })),
    proposal: vi.fn(() => ({ key: definition.key, name: definition.name, root: definition.root })),
    reload: vi.fn(async () => {}),
    refreshRoots: vi.fn(),
    edit: vi.fn(async () => catalog.file.path),
  };
  const windows = new Map(
    [1, 2].map((owner) => [owner, { isDestroyed: () => false, show: vi.fn(), focus: vi.fn() }]),
  );
  const isAgent = vi.fn(() => false);
  const memory = {
    get: vi.fn(),
    problem: vi.fn(() => undefined as string | undefined),
    remember: vi.fn<DefinedWorkspaces['remember']>(async () => {}),
    forget: vi.fn(async () => {}),
  };
  const handlers = createDefinitionHandlers({
    definitions,
    memory,
    sessions,
    isAgent,
    window: (owner) => windows.get(owner) as unknown as BrowserWindow | undefined,
    fileAccess: {
      scoped: false,
      require: async () => {},
      remember: async () => {},
      allowOnce: async () => {},
    },
  });
  const open = (owner: number) =>
    handlers.workspaceDefinitions([{ kind: 'open', key: definition.key }], owner);
  return {
    sessions,
    a,
    b,
    first,
    second,
    definition,
    definitions,
    windows,
    isAgent,
    handlers,
    memory,
    open,
  };
}

describe('desktop definition open decisions', () => {
  it('allows Save as for a removed link only after a valid catalog load', async () => {
    const f = fixture();
    const space = sampleWorkspace('removed', {
      definition: { key: 'removed', basis: f.definition.basis },
    });
    f.a.workspaces.push(space);
    f.sessions.save(1, f.a);
    await expect(
      f.handlers.workspaceDefinitions(
        [{ kind: 'save-as', workspaceID: space.id, key: 'sample/new', name: 'Sample', order: [] }],
        1,
      ),
    ).resolves.toMatchObject({ kind: 'saved' });
    expect(f.definitions.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: space.id }),
      [],
      true,
      { key: 'sample/new', name: 'Sample' },
      expect.any(Function),
    );
  });
  it.each(['close', 'reset', 'save'] as const)(
    'refuses %s under another window’s reservation',
    async (kind) => {
      const f = fixture();
      const space = sampleWorkspace('unowned', {
        definition: { key: f.definition.key, basis: f.definition.basis },
      });
      f.a.workspaces.push(space);
      f.sessions.save(1, f.a);
      f.sessions.reserveDefinition(2, f.definition.key);
      await expect(
        f.handlers.workspaceDefinitions([{ kind, workspaceID: space.id, order: [] }], 1),
      ).rejects.toThrow('being changed in another window');
      expect(f.memory.remember).not.toHaveBeenCalled();
      expect(f.memory.forget).not.toHaveBeenCalled();
      expect(f.definitions.save).not.toHaveBeenCalled();
    },
  );
  it('rechecks the person after reserving a linked key', async () => {
    const f = fixture();
    const space = sampleWorkspace('linked', {
      definition: { key: f.definition.key, basis: f.definition.basis },
    });
    f.a.workspaces.push(space);
    f.sessions.save(1, f.a);
    vi.spyOn(f.sessions, 'reserveDefinition').mockImplementation(() => {
      f.isAgent.mockReturnValue(true);
      return 1;
    });
    await expect(
      f.handlers.workspaceDefinitions([{ kind: 'close', workspaceID: space.id }], 1),
    ).rejects.toThrow('only to the person');
    expect(f.memory.remember).not.toHaveBeenCalled();
  });
  it('rechecks the person inside the Save callback', async () => {
    const f = fixture();
    const space = sampleWorkspace('linked', {
      definition: { key: f.definition.key, basis: f.definition.basis },
    });
    f.a.workspaces.push(space);
    f.sessions.save(1, f.a);
    f.definitions.save.mockImplementationOnce(
      async (_space, _order, _confirmed, _create, human) => {
        f.isAgent.mockReturnValue(true);
        human?.();
        throw new Error('Save reached the write.');
      },
    );
    await expect(
      f.handlers.workspaceDefinitions([{ kind: 'save', workspaceID: space.id, order: [] }], 1),
    ).rejects.toThrow('only to the person');
  });
  it('refuses Save as for an open key and for another window’s reservation', async () => {
    const f = fixture();
    const space = sampleWorkspace('already-open', {
      definition: { key: f.definition.key, basis: f.definition.basis },
    });
    f.a.workspaces.push(space);
    f.sessions.save(1, f.a);
    const request = {
      kind: 'save-as' as const,
      workspaceID: f.first,
      key: f.definition.key,
      name: 'Sample',
      order: [],
    };
    await expect(f.handlers.workspaceDefinitions([request], 1)).rejects.toThrow('already open');
    f.sessions.reserveDefinition(2, 'sample/new');
    await expect(
      f.handlers.workspaceDefinitions([{ ...request, key: 'sample/new' }], 1),
    ).rejects.toThrow('being opened in another window');
    expect(f.definitions.save).not.toHaveBeenCalled();
  });
  it('refuses Forget under another window’s reservation even with no open workspace', async () => {
    const f = fixture();
    f.sessions.reserveDefinition(2, f.definition.key);
    await expect(
      f.handlers.workspaceDefinitions([{ kind: 'forget', key: f.definition.key }], 1),
    ).rejects.toThrow('Switch to that window');
    expect(f.memory.forget).not.toHaveBeenCalled();
  });
  it('asks before closing without memory when the persisted snapshot is too large', async () => {
    const f = fixture();
    const space = sampleWorkspace('large', {
      definition: { key: f.definition.key, basis: f.definition.basis },
    });
    f.a.workspaces.push(space);
    f.sessions.save(1, f.a);
    f.memory.problem.mockReturnValue('this workspace alone exceeds the 16 MB memory limit');
    expect(
      await f.handlers.workspaceDefinitions([{ kind: 'close', workspaceID: space.id }], 1),
    ).toMatchObject({ kind: 'close-info', problem: expect.stringContaining('16 MB') });
    expect(f.memory.remember).not.toHaveBeenCalled();
    expect(
      await f.handlers.workspaceDefinitions(
        [{ kind: 'close', workspaceID: space.id, withoutMemory: true }],
        1,
      ),
    ).toEqual({ kind: 'closed' });
    expect(f.memory.remember).not.toHaveBeenCalled();
  });
  it('stores a fresh scratch buffer and no editor buffer after the close prompts were accepted', async () => {
    const f = fixture();
    const space = sampleWorkspace('text', {
      definition: { key: f.definition.key, basis: f.definition.basis },
      panes: [
        { id: 'scratch', type: 'scratch', path: '/projects/sample', bufferID: 'discarded' },
        { id: 'file', type: 'preview', path: '/projects/sample/readme.txt', bufferID: 'edited' },
      ],
      roots: ['scratch', 'file'],
    });
    f.a.workspaces.push(space);
    f.sessions.save(1, f.a);
    await f.handlers.workspaceDefinitions([{ kind: 'close', workspaceID: space.id }], 1);
    const stored = f.memory.remember.mock.calls[0]![0] as typeof space;
    expect(stored.panes[0]).toMatchObject({ type: 'scratch', bufferID: expect.any(String) });
    expect(stored.panes[0]).not.toMatchObject({ bufferID: 'discarded' });
    expect(stored.panes[1]).not.toHaveProperty('bufferID');
    expect(space.panes[0]).toMatchObject({ bufferID: 'discarded' });
  });
  it('closes only a persisted record, preserves its preview metadata, and reserves against another reopening window', async () => {
    const f = fixture();
    const space = sampleWorkspace('remembered', {
      definition: { key: f.definition.key, basis: f.definition.basis },
    });
    f.a.workspaces.push(space);
    f.a.activeWorkspace = space.id;
    f.a.previewStates = { [space.id + ':file']: { page: 5 } };
    f.a.previewHistory = {
      [space.id]: [
        { path: '/projects/sample/readme.pdf', updated: Date.now(), values: { 'pdf.page': 5 } },
      ],
    };
    f.sessions.save(1, f.a);
    expect(
      await f.handlers.workspaceDefinitions([{ kind: 'close', workspaceID: space.id }], 1),
    ).toEqual({ kind: 'closed' });
    expect(f.memory.remember).toHaveBeenCalledWith(
      space,
      expect.objectContaining({
        previewStates: f.a.previewStates,
        previewHistory: f.a.previewHistory,
      }),
    );
    await expect(
      f.handlers.workspaceDefinitions([{ kind: 'close', workspaceID: space.id }], 2),
    ).rejects.toThrow('Switch to that window to close it.');
    expect(await f.open(2)).toEqual({ kind: 'elsewhere' });
    f.a.workspaces = f.a.workspaces.filter((item) => item.id !== space.id);
    f.a.activeWorkspace = f.first;
    f.sessions.save(1, f.a);
    expect(f.sessions.definitionOwner(f.definition.key)).toBeUndefined();
    const closed = { workspace: space, basis: f.definition.basis };
    f.memory.get.mockReturnValue(closed as never);
    const result = await f.open(2);
    expect(result).toMatchObject({ kind: 'build', closed });
    expect(await f.open(1)).toEqual({ kind: 'elsewhere' });
  });
  it('forgets a snapshot on reset and enforces ownership for save, reset and forget', async () => {
    const f = fixture();
    const space = sampleWorkspace('linked', {
      definition: { key: f.definition.key, basis: f.definition.basis },
    });
    f.a.workspaces.push(space);
    f.a.activeWorkspace = space.id;
    f.sessions.save(1, f.a);
    for (const kind of ['save', 'reset'] as const)
      await expect(
        f.handlers.workspaceDefinitions([{ kind, workspaceID: space.id, order: [] }], 2),
      ).rejects.toThrow('Switch to that window');
    await expect(
      f.handlers.workspaceDefinitions([{ kind: 'forget', key: f.definition.key }], 2),
    ).rejects.toThrow('Switch to that window');
    expect(
      await f.handlers.workspaceDefinitions([{ kind: 'reset', workspaceID: space.id }], 1),
    ).toMatchObject({ kind: 'reset', definition: { key: f.definition.key } });
    expect(f.memory.forget).toHaveBeenCalledWith(f.definition.key);
  });
  it('checks an unknown selected root before building and refuses a missing result', async () => {
    const f = fixture();
    f.definition.rootState = 'unknown';
    f.definitions.checkRoot.mockResolvedValueOnce('missing' as never);
    await expect(f.open(1)).rejects.toThrow('root folder');
    expect(f.sessions.definitionOwner(f.definition.key)).toBeUndefined();
  });
  it('rechecks unavailable roots when workspace search asks for the catalog', async () => {
    const f = fixture();
    await f.handlers.workspaceDefinitionFile([{ kind: 'catalog' }], 1);
    expect(f.definitions.refreshRoots).toHaveBeenCalledOnce();
  });
  it('reserves the first window and focuses it when a second window asks to build the same key', async () => {
    const f = fixture();
    const [a, b] = await Promise.all([f.open(1), f.open(2)]);
    expect(a).toMatchObject({ kind: 'build', definition: { key: f.definition.key } });
    expect(a).toHaveProperty('closed', undefined);
    expect(a).not.toHaveProperty('tickets');
    expect(b).toEqual({ kind: 'elsewhere' });
    expect(f.windows.get(1)!.focus).toHaveBeenCalledOnce();
    expect(f.definitions.opened).toHaveBeenCalledTimes(1);
  });
  it('switches when open here or unowned and focuses another owner when open there', async () => {
    const f = fixture();
    const built = sampleWorkspace('built', {
      definition: { key: f.definition.key, basis: f.definition.basis },
    });
    f.a.workspaces.push(built);
    f.a.activeWorkspace = built.id;
    f.sessions.save(1, f.a);
    expect(await f.open(1)).toEqual({ kind: 'active', workspaceID: built.id });
    expect(await f.open(2)).toEqual({ kind: 'elsewhere' });
    f.sessions.close(1);
    expect(await f.open(2)).toEqual({ kind: 'active', workspaceID: built.id });
  });
  it('refuses every definition action before catalog access in an agent-driven window', async () => {
    const f = fixture();
    f.isAgent.mockReturnValue(true);
    await expect(f.open(1)).rejects.toThrow('only to the person');
    for (const kind of ['close-info', 'close', 'reset', 'save', 'save-as'] as const)
      await expect(
        f.handlers.workspaceDefinitions([{ kind, workspaceID: f.first, order: [] }], 1),
      ).rejects.toThrow('only to the person');
    await expect(
      f.handlers.workspaceDefinitions([{ kind: 'forget', key: f.definition.key }], 1),
    ).rejects.toThrow('only to the person');
    for (const kind of ['catalog', 'edit', 'validate', 'allow-source'] as const) {
      await expect(f.handlers.workspaceDefinitionFile([{ kind }], 1)).rejects.toThrow(
        'only to the person',
      );
    }
    expect(f.definitions.load).not.toHaveBeenCalled();
    expect(f.definitions.entry).not.toHaveBeenCalled();
  });
  it('rechecks agent ownership after asynchronous loading', async () => {
    const f = fixture();
    f.definitions.load.mockImplementation(async () => {
      f.isAgent.mockReturnValue(true);
    });
    await expect(f.open(1)).rejects.toThrow('only to the person');
    expect(f.definitions.entry).not.toHaveBeenCalled();
  });
  it('refuses hidden, missing and nonexistent keys without a build', async () => {
    const f = fixture();
    f.definition.hidden = true;
    await expect(f.open(1)).rejects.toThrow('unavailable');
    f.definition.hidden = false;
    f.definition.rootState = 'missing';
    await expect(f.open(1)).rejects.toThrow('missing');
    await expect(
      f.handlers.workspaceDefinitions([{ kind: 'open', key: 'missing' }], 1),
    ).rejects.toThrow('unavailable');
  });
  it('edits via the operating system and validates without mutating a definition', async () => {
    const f = fixture();
    await f.handlers.workspaceDefinitionFile([{ kind: 'edit' }], 1);
    expect(native.open).toHaveBeenCalledWith('/data/workspaces.jsonc');
    await f.handlers.workspaceDefinitionFile([{ kind: 'validate' }], 1);
    expect(f.definitions.reload).toHaveBeenCalledOnce();
    await f.handlers.workspaceDefinitionFile([{ kind: 'allow-source' }], 1);
    expect(native.choose).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ properties: ['openDirectory'], defaultPath: '/source' }),
      true,
    );
  });
});
