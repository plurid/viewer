// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { ActionParameters } from '../src/renderer/commands/ActionParameters';
import { programCommands } from '../src/renderer/commands/programs';
import { commandFolders } from '../src/renderer/commands/folders';
import { activeWorkspace, getState, initialize } from '../src/renderer/state/store';
import type { CommandContext, ResolvedCommand } from '../src/renderer/commands/registry';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import type { CustomAction, ExecutionTask } from '../src/domain/automation/actions';
import type { DesktopEvent } from '../src/domain/contracts';
import { agentCommandID } from '../src/domain/agents/safety';

HTMLDialogElement.prototype.showModal ??= function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function () {
  this.removeAttribute('open');
};
let listeners: Set<(event: DesktopEvent) => void>;
let tasks: ExecutionTask[];
const execute = vi.fn(async (id: string, _target: unknown, _values: unknown) => {
  tasks.push({ id, title: id, status: 'running', output: '' });
  return id;
});
const action = (id: string): CustomAction => ({
  id,
  name: id,
  aliases: [],
  icon: 'command',
  shortcut: '',
  order: 0,
  pinned: false,
  when: { target: 'any', extensions: [], min: 0, max: 100 },
  executor: { kind: 'executable', executable: '/usr/bin/true', args: [], perItem: false },
});
beforeEach(() => {
  listeners = new Set();
  tasks = [];
  execute.mockClear();
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
      customExecute: execute,
      executionList: async () => tasks,
      onEvent: (listener: (event: DesktopEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  });
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
afterEach(cleanup);
const status = (id: string, state: ExecutionTask['status']) => {
  const task = tasks.find((task) => task.id === id)!;
  task.status = state;
  for (const listener of listeners) listener({ type: 'execution', task: { ...task } });
};
function command(actions: CustomAction[]) {
  getState().settings.settings.customActions = actions;
  const space = activeWorkspace(),
    pane = space.panes[0]!;
  const context: CommandContext = {
    scope: 'folder',
    workspaceID: space.id,
    paneID: pane.id,
    path: pane.path,
    directory: pane.path,
    selection: [],
    clipboard: null,
    jobs: [],
  };
  return {
    context,
    run: () =>
      programCommands(
        { rootID: () => pane.id } as unknown as WorkspaceController,
        vi.fn(async () => true),
      )
        .find((command) => command.id === 'custom.workflow')!
        .run(context),
  };
}
it('waits for process completion and stops the workflow after failure', async () => {
  const workflow = {
    ...action('workflow'),
    executor: {
      kind: 'workflow' as const,
      steps: [
        { kind: 'action' as const, actionID: 'test' },
        { kind: 'action' as const, actionID: 'build' },
      ],
    },
  };
  const c = command([action('test'), action('build'), workflow]);
  const work = c.run();
  await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  expect(execute.mock.calls[0]?.[0]).toBe('test');
  status('test', 'failed');
  await expect(work).rejects.toThrow('step 1');
  expect(execute).toHaveBeenCalledTimes(1);
  expect(() => agentCommandID('custom.workflow', [workflow])).toThrow('bypass Trash');
});
it('gathers typed parameters once and passes them literally through successful steps', async () => {
  const first = action('test');
  first.inputs = [{ name: 'name', label: 'Build name', kind: 'text', required: true }];
  const workflow = {
    ...action('workflow'),
    executor: {
      kind: 'workflow' as const,
      steps: [
        { kind: 'action' as const, actionID: 'test' },
        { kind: 'action' as const, actionID: 'build' },
      ],
    },
  };
  const c = command([first, action('build'), workflow]);
  render(<ActionParameters />);
  let work: ReturnType<typeof c.run>;
  act(() => {
    work = c.run();
  });
  fireEvent.change(await screen.findByLabelText('Build name'), {
    target: { value: 'literal $(touch marker)' },
  });
  fireEvent.submit(screen.getByRole('button', { name: 'Run' }).closest('form')!);
  await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  expect(execute.mock.calls[0]?.[2]).toEqual({ name: 'literal $(touch marker)' });
  status('test', 'completed');
  await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
  status('build', 'completed');
  await work!;
  expect(listeners.size).toBe(0);
});
it('places commands inside nested palette folders while keeping search direct', () => {
  const row: ResolvedCommand = {
    id: 'custom.test',
    label: 'Test',
    group: 'Actions',
    paletteFolder: ['Development', 'Checks'],
    aliases: [],
    primary: false,
    source: 'window',
    context: {
      scope: 'window',
      workspaceID: activeWorkspace().id,
      selection: [],
      clipboard: null,
      jobs: [],
    },
  };
  const root = commandFolders([row], [row], [], '');
  expect(root.rows.map((row) => row.label)).toEqual(['Development']);
  expect(commandFolders([row], [row], ['Development'], '').rows.map((row) => row.label)).toEqual([
    'Checks',
  ]);
  expect(commandFolders([row], [row], ['Development', 'Checks'], '').rows).toEqual([row]);
  expect(commandFolders([row], [row], [], 'test').rows).toEqual([row]);
});
