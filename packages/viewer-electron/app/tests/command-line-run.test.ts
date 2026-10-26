// @vitest-environment jsdom
/**
 * Running a line: checked whole before anything runs, each step against the live plane,
 * stopping at the first that cannot run; vim's verbs over Viewer's commands.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { runLine } from '../src/renderer/command-line/run';
import type { LineHost } from '../src/renderer/command-line/host';
import {
  CommandRegistry,
  type CommandContext,
  type CommandDefinition,
} from '../src/renderer/commands/registry';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import {
  activeWorkspace,
  addRootFolder,
  getState,
  initialize,
  setActivePane,
} from '../src/renderer/state/store';
import { registerEditingPlane } from '../src/renderer/editing/planes';
import { agentCommandID } from '../src/domain/agents/safety';
import { receiveJob } from '../src/renderer/state/jobs';
import type { OperationJob } from '../src/domain/contracts';

const settingsPatch = vi.fn(async (patches: { path: string; value: unknown }[]) => {
  const snapshot = structuredClone(getState().settings);
  snapshot.revision++;
  for (const { path, value } of patches) {
    const keys = path.split('.').slice(1);
    let target = snapshot.settings as unknown as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
    target[keys.at(-1)!] = value;
  }
  return snapshot;
});
const viewer = {
  save: vi.fn(async () => {}),
  settingsPatch,
  openSettings: vi.fn(async () => {}),
  textPrompt: vi.fn(async () => 'cancel'),
  stat: vi.fn(async (path: string) => ({
    path,
    name: path.split('/').pop(),
    directory: !path.includes('.'),
  })),
  operate: vi.fn(async () => 'job'),
};
let ran: string[];
let parents: Record<string, string | undefined>;
const workspace = {
  subtree: (id: string) => [id, ...Object.keys(parents).filter((child) => parents[child] === id)],
  parentPaneID: (id: string) => parents[id],
  closePane: vi.fn(),
  openPath: vi.fn(async () => {}),
  retile: vi.fn(),
} as unknown as WorkspaceController;
const context = (): CommandContext => {
  const state = getState();
  const pane = activeWorkspace().panes.find((item) => item.id === state.activePane);
  return {
    scope: 'window',
    workspaceID: state.saved.activeWorkspace,
    paneID: state.activePane,
    directory: pane?.type === 'folder' ? pane.path : undefined,
    path: pane?.path,
    selection: [],
    jobs: [],
    clipboard: null,
  } as unknown as CommandContext;
};
const host = (definitions: CommandDefinition[] = []): LineHost => {
  const registry = new CommandRegistry();
  registry.register('window', { context, definitions: () => definitions });
  return {
    registry,
    workspace,
    context,
    invoke: (id, remember) =>
      registry.invoke(id, {
        paneID: context().paneID,
        scope: 'window',
        context: context(),
        remember,
      }),
    newWorkspace: vi.fn(async () => {}),
    switchWorkspace: vi.fn(async () => {}),
    palette: vi.fn(),
  };
};
const command = (id: string, available = true): CommandDefinition => ({
  id,
  label: id.replace(/-/g, ' '),
  group: 'Test',
  when: () => available,
  run: () => {
    ran.push(id);
  },
});
beforeEach(() => {
  ran = [];
  parents = {};
  for (const method of Object.values(viewer)) method.mockClear();
  (workspace.closePane as ReturnType<typeof vi.fn>).mockClear();
  (workspace.openPath as ReturnType<typeof vi.fn>).mockClear();
  Object.assign(window, { viewer });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
  viewer.operate.mockImplementation(async () => {
    const id = crypto.randomUUID();
    receiveJob({
      id,
      revision: 1,
      kind: 'mkdir',
      status: 'completed',
      sources: [],
      bytesDone: 0,
      bytesTotal: 0,
      itemsDone: 1,
      itemsTotal: 1,
      completed: [],
      errors: [],
      errorCount: 0,
      undoable: false,
    });
    return id;
  });
});

describe('a line', () => {
  it('waits for an actual file-operation outcome before starting its next step', async () => {
    const id = crypto.randomUUID();
    const job: OperationJob = {
      id,
      revision: 1,
      kind: 'mkdir',
      status: 'collision',
      sources: [],
      destination: '/fixtures',
      bytesDone: 0,
      bytesTotal: 0,
      itemsDone: 0,
      itemsTotal: 1,
      completed: [],
      errors: [],
      errorCount: 0,
      undoable: false,
      collision: { source: '', destination: '/fixtures/a', replaceable: false },
    };
    viewer.operate.mockImplementationOnce(async () => {
      receiveJob(job);
      return id;
    });
    const result = runLine('mkdir a | mkdir b', host());
    await vi.waitFor(() => expect(viewer.operate).toHaveBeenCalledTimes(1));
    expect(getState().operationsOpen).toBe(true);
    receiveJob({ ...job, revision: 2, status: 'completed', collision: undefined, itemsDone: 1 });
    expect(await result).toEqual({ ok: true });
    expect(viewer.operate).toHaveBeenCalledTimes(2);
  });
  it('stops later file creation after a failed or cancelled operation', async () => {
    for (const status of ['failed', 'cancelled'] as const) {
      viewer.operate.mockClear();
      viewer.operate.mockImplementationOnce(async () => {
        const id = crypto.randomUUID();
        receiveJob({
          id,
          revision: 1,
          kind: 'mkdir',
          status,
          sources: [],
          bytesDone: 0,
          bytesTotal: 0,
          itemsDone: 0,
          itemsTotal: 1,
          completed: [],
          errors:
            status === 'failed'
              ? [{ path: '/fixtures/a', message: 'Generated creation failure' }]
              : [],
          errorCount: status === 'failed' ? 1 : 0,
          undoable: false,
        });
        return id;
      });
      const result = await runLine('mkdir a | mkdir b', host());
      expect(result.ok).toBe(false);
      expect(viewer.operate).toHaveBeenCalledTimes(1);
      if (status === 'failed') expect(result.message).toContain('Generated creation failure');
    }
  });
  it('runs its steps in order, a count again, and stops at one that cannot run', async () => {
    const live = host([command('a'), command('b', false), command('c')]);
    expect(await runLine('2 a | c', live)).toEqual({ ok: true });
    expect(ran).toEqual(['a', 'a', 'c']);
    ran = [];
    expect(await runLine('a | b | c', live)).toEqual({
      ok: false,
      message: '“b” is not available here.',
    });
    expect(ran).toEqual(['a']);
  });
  it('is checked whole first: a typo in step two leaves step one undone', async () => {
    const live = host([command('tile-split-right')]);
    const result = await runLine('tile-split-right | tile-splt-right', live);
    expect(result).toEqual({
      ok: false,
      message: 'Not a command: tile-splt-right — did you mean tile-split-right?',
      at: 19,
    });
    expect(ran).toEqual([]);
    expect((await runLine('tile-split-right x', live)).message).toMatch(/takes no words/);
    expect((await runLine('Dev', live)).message).toBe('No command :Dev.');
  });
  it('is never a command an agent may propose', () => {
    for (const line of ['q!', 'frame-all | q', 'setting.ui.space.grid | q', 'set grid!'])
      expect(() => agentCommandID(line, [])).toThrow();
  });
});

describe('set', () => {
  it('changes, toggles, shows and resets settings by name', async () => {
    const live = host();
    await act(async () => void (await runLine('set nogrid opacity=60', live)));
    expect(getState().saved.ui.space.grid).toBe(false);
    expect(getState().saved.ui.space.backdropOpacity).toBe(60);
    await act(async () => void (await runLine('set grid! opacity+=10', live)));
    expect(getState().saved.ui.space.grid).toBe(true);
    expect(getState().saved.ui.space.backdropOpacity).toBe(70);
    expect(await runLine('set grid? opacity?', live)).toEqual({
      ok: true,
      message: 'grid  opacity=70',
    });
    await act(async () => void (await runLine('set opacity&', live)));
    expect(getState().saved.ui.space.backdropOpacity).toBe(60);
    await act(async () => void (await runLine('set wrap!', live)));
    expect(settingsPatch).toHaveBeenCalledWith(
      [
        {
          path: 'settings.editor.wordWrap',
          value: !getState().settings.settings.editor.wordWrap === false,
        },
      ],
      expect.any(Number),
    );
  });
  it('opens Settings for what only Settings changes', async () => {
    expect(await runLine('set noconfirmtrash', host())).toEqual({
      ok: true,
      message: 'confirmtrash changes in Settings.',
    });
    expect(viewer.openSettings).toHaveBeenCalledWith('settings.browsing.confirmTrash');
    expect(getState().settings.settings.browsing.confirmTrash).toBe(true);
  });
  it('sets this workspace’s own with setlocal, and only what a workspace may', async () => {
    const live = host();
    await act(async () => void (await runLine('setl nominimap', live)));
    expect(activeWorkspace().overrides).toEqual({ 'ui.space.minimap': false });
    expect(getState().saved.ui.space.minimap).toBe(true);
    await act(async () => void (await runLine('setl minimap&', live)));
    expect(activeWorkspace()).not.toHaveProperty('overrides');
    await act(async () => void (await runLine('setl backdrop=blur', live)));
    expect(activeWorkspace().overrides).toEqual({ 'ui.space.backdrop': 'blur' });
    expect(getState().saved.ui.space.backdrop).toBe('opaque');
  });
  it('with nothing after it lists the settings', async () => {
    const live = host();
    await runLine('set', live);
    expect(live.palette).toHaveBeenCalledWith('settings');
  });
});

describe('closing', () => {
  const unsavedPlane = (id: string) => {
    const plane = {
      dirty: () => true,
      save: vi.fn(async () => true),
      discard: vi.fn(async () => {}),
    };
    registerEditingPlane(id, plane);
    return plane;
  };
  it('asks about unsaved text with :q, and Cancel closes nothing', async () => {
    const id = getState().activePane;
    unsavedPlane(id);
    expect(await runLine('q', host())).toEqual({ ok: false });
    expect(viewer.textPrompt).toHaveBeenCalledWith('close', expect.any(String));
    expect(workspace.closePane).not.toHaveBeenCalled();
  });
  it('drops unsaved text without asking with :q!, as vim', async () => {
    const id = getState().activePane;
    const plane = unsavedPlane(id);
    expect(await runLine('q!', host())).toEqual({ ok: true });
    expect(viewer.textPrompt).not.toHaveBeenCalled();
    expect(plane.discard).toHaveBeenCalled();
    expect(workspace.closePane).toHaveBeenCalledWith(id);
  });
  it(':qa closes every plane, each root with its own; :only all but one and its origins', async () => {
    const first = getState().activePane;
    const second = addRootFolder({ path: '/fixtures/b' })!.id;
    const child = addRootFolder({ path: '/fixtures/c' })!.id;
    parents = { [child]: first };
    const closed = () =>
      (workspace.closePane as ReturnType<typeof vi.fn>).mock.calls.map(([id]) => id as string);
    await runLine('qa!', host());
    // the child closes with the plane it was opened from
    expect(closed().sort()).toEqual([first, second].sort());
    (workspace.closePane as ReturnType<typeof vi.fn>).mockClear();
    act(() => setActivePane(child));
    await runLine('on!', host());
    expect(closed()).toEqual([second]);
  });
});

describe('going places', () => {
  it('edits a path, a text file for editing; changes folder; says where it is', async () => {
    const live = host();
    await runLine('e ~/notes.md', live);
    expect(workspace.openPath).toHaveBeenCalledWith(
      '/fixtures/notes.md',
      expect.objectContaining({ edit: true, activate: true }),
    );
    await act(async () => void (await runLine('cd ~/Docs | pwd', live)));
    expect(activeWorkspace().panes.find((pane) => pane.id === getState().activePane)?.path).toBe(
      '/fixtures/Docs',
    );
    // pwd read the plane after cd, not before
    expect(await runLine('pwd', live)).toEqual({ ok: true, message: '/fixtures/Docs' });
  });
  it('makes folders and files here', async () => {
    await runLine('mkdir Drafts | touch "a b.md"', host());
    expect(viewer.operate).toHaveBeenNthCalledWith(1, {
      kind: 'mkdir',
      name: 'Drafts',
      sources: [],
      destination: '/fixtures',
    });
    expect(viewer.operate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ kind: 'mkfile', name: 'a b.md' }),
    );
  });
  it('makes and finds workspaces by name or number', async () => {
    const live = host();
    await runLine('tabnew Studio', live);
    expect(live.newWorkspace).toHaveBeenCalledWith('Studio');
    await runLine(`tabn ${activeWorkspace().name.slice(0, 3)}`, live);
    expect(live.switchWorkspace).toHaveBeenCalledWith(activeWorkspace().id);
    await runLine('tabn 1', live);
    expect(live.switchWorkspace).toHaveBeenLastCalledWith(getState().saved.workspaces[0]!.id);
    expect((await runLine('tabn Nowhere', live)).message).toMatch(/No workspace “Nowhere”/);
  });
  it('picks a theme by its name, and opens help in the command line', async () => {
    const live = host([
      { ...command('theme.night-1'), label: 'Theme: Night Owl' },
      { ...command('theme.viewer-dark'), label: 'Theme: Viewer Dark' },
    ]);
    await runLine('colo night owl', live);
    expect(ran).toEqual(['theme.night-1']);
    await runLine('h set', live);
    expect(live.palette).toHaveBeenCalledWith('line', 'help set');
  });
});
