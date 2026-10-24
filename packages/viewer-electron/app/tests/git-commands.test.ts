// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry, FolderPane } from '../src/domain/contracts';
import { gitActionKinds } from '../src/domain/comparison/git-actions';
import { agentCommandID } from '../src/domain/agents/safety';
import { gitCommands, type GitCommandActions } from '../src/renderer/git/commands';
import {
  CommandRegistry,
  rankCommands,
  type CommandContext,
} from '../src/renderer/commands/registry';
import { contextMenuSections } from '../src/renderer/commands/menu';
import { windowScopes, type WindowActions } from '../src/renderer/commands/window-commands/scope';
import { activeWorkspace, getState, initialize } from '../src/renderer/state/store';

const start = vi.fn<GitCommandActions['start']>(async () => {});
const commit = vi.fn<GitCommandActions['commit']>(async () => {});
const actions = {
  workspace: { rootID: () => 'root' },
  ready: true,
} as unknown as WindowActions;

const entry = (name: string, directory = false): FileEntry => ({
  path: `/fixture/${name}`,
  name,
  parent: '/fixture',
  extension: directory ? '' : 'txt',
  kind: directory ? 'directory' : 'file',
  directory,
  size: 20,
  created: 1,
  modified: 1,
  hidden: false,
  mime: 'text/plain',
  identity: '1:2',
});

beforeEach(() => {
  start.mockReset();
  start.mockResolvedValue(undefined);
  commit.mockReset();
  commit.mockResolvedValue(undefined);
  actions.ready = true;
  Object.assign(window, { viewer: { save: vi.fn(async () => {}) } });
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
});

function context(selection: FileEntry[] = []): CommandContext {
  const workspace = activeWorkspace();
  const pane = workspace.panes[0] as FolderPane;
  return {
    scope: selection.length ? 'files' : 'folder',
    workspaceID: workspace.id,
    paneID: pane.id,
    rootID: 'root',
    path: pane.path,
    directory: '/fixture',
    folder: pane,
    selection,
    clipboard: null,
    jobs: [],
  };
}

function registry(target: CommandContext) {
  const commands = new CommandRegistry();
  commands.register('window', {
    context: () => target,
    definitions: () => gitCommands(windowScopes(actions), { start, commit }),
  });
  return commands;
}

describe('explicit Git commands', () => {
  it('uses the real Git menu group and stays available while background status is disabled', () => {
    expect(getState().settings.settings.git.enabled).toBe(false);
    const commands = registry(context()).list();
    expect(commands.map((command) => command.id)).toEqual(
      gitActionKinds
        .filter((kind) => kind !== 'stage-selected')
        .map((kind) => `git-action.${kind}`),
    );
    expect(commands.every((command) => command.group === 'Git')).toBe(true);
    const sections = contextMenuSections(commands, []);
    expect(sections.flatMap((section) => section.entries)).toContainEqual(
      expect.objectContaining({ kind: 'submenu', label: 'Git' }),
    );
    expect(rankCommands(commands, 'git log', [])[0]?.id).toBe('git-action.log');
    expect(commands.find((command) => command.id === 'git-action.pull')?.label).toContain(
      'fast-forward only',
    );
    expect(commands.find((command) => command.id === 'git-action.commit')?.label).toContain(
      'staged changes',
    );
  });

  it('offers stage-selected only for usable paths and supports ordinary Git symlinks', () => {
    const definitions = gitCommands(windowScopes(actions), { start, commit });
    const selected = definitions.find((command) => command.id === 'git-action.stage-selected')!;
    expect(selected.when(context())).toBe(false);
    expect(selected.when(context([entry('notes.txt')]))).toBe(true);
    expect(selected.when(context([entry('folder', true)]))).toBe(true);
    expect(selected.when(context([{ ...entry('link'), kind: 'symlink' }]))).toBe(true);
    expect(selected.when(context([{ ...entry('broken.txt'), error: 'Unavailable' }]))).toBe(false);
    expect(selected.when(context([{ ...entry('socket'), kind: 'other' }]))).toBe(false);
  });

  it('uses only an owned folder origin in folder, file or window scope', () => {
    const definitions = gitCommands(windowScopes(actions), { start, commit });
    for (const scope of ['folder', 'files', 'window'] as const)
      expect(definitions[0]!.when({ ...context(), scope })).toBe(true);
    for (const malformed of [
      { ...context(), scope: 'preview' as const },
      { ...context(), scope: 'sidebar' as const },
      { ...context(), scope: 'workspace' as const },
      { ...context(), directory: undefined },
      { ...context(), paneID: undefined },
      { ...context(), paneID: 'not-owned' },
      { ...context(), workspaceID: 'another-workspace' },
    ])
      expect(definitions.every((command) => !command.when(malformed))).toBe(true);
    actions.ready = false;
    expect(definitions.every((command) => !command.when(context()))).toBe(true);
  });

  it('captures all selected identities before asynchronous dispatch', async () => {
    let finish!: () => void;
    start.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const selected = entry('notes.txt');
    const target = context([selected]);
    const commands = registry(target);
    const invoked = commands.invoke('git-action.stage-selected', {});
    selected.identity = 'changed';
    selected.path = '/fixture/changed.txt';
    target.selection = [];
    expect(start).toHaveBeenCalledExactlyOnceWith(
      'stage-selected',
      expect.objectContaining({
        workspaceID: target.workspaceID,
        paneID: target.paneID,
        rootID: 'root',
        panePath: '/fixture',
        directory: '/fixture',
        selection: [expect.objectContaining({ path: '/fixture/notes.txt', identity: '1:2' })],
      }),
    );
    finish();
    expect(await invoked).toBe(true);
  });

  it('keeps every action in the current folder repository when a child folder is selected', async () => {
    const target = context([entry('different-repository', true)]);
    const commands = registry(target);
    for (const kind of gitActionKinds)
      expect(await commands.invoke(`git-action.${kind}`, {})).toBe(true);
    expect(start).toHaveBeenCalledTimes(gitActionKinds.length - 1);
    for (const [, captured] of start.mock.calls) {
      expect(captured.directory).toBe('/fixture');
      expect(captured.selection[0]?.path).toBe('/fixture/different-repository');
    }
    expect(commit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ directory: '/fixture', panePath: '/fixture' }),
    );
  });

  it('rejects invalid direct invocations and keeps the entire catalog outside agent authority', async () => {
    const definitions = gitCommands(windowScopes(actions), { start, commit });
    await expect(definitions[0]!.run({ ...context(), paneID: 'not-owned' })).rejects.toThrow(
      'Choose an open folder',
    );
    const selected = definitions.find((command) => command.id === 'git-action.stage-selected')!;
    await expect(selected.run(context())).rejects.toThrow('Select files or folders');
    for (const definition of definitions) expect(() => agentCommandID(definition.id, [])).toThrow();
    expect(start).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
});
