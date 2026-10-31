// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DesktopEvent } from '../src/domain/contracts';
import type { ExecutionTask } from '../src/domain/automation/actions';
import type { CommandContext } from '../src/renderer/commands/registry';
import { WorkspaceContext, type WorkspaceController } from '../src/renderer/workspace/context';
import { activeWorkspace, initialize } from '../src/renderer/state/store';
import { QuickCommand } from '../src/renderer/terminals/QuickCommand';
import { ExecutionPanel } from '../src/renderer/terminals/ExecutionPanel';

afterEach(cleanup);
it('runs once, streams inline, and reconnects after closing without cancelling or resubmitting', async () => {
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
  const listeners = new Set<(event: DesktopEvent) => void>();
  let task: ExecutionTask | undefined;
  const send = () => listeners.forEach((listener) => listener({ type: 'execution', task: task! }));
  const runCommand = vi.fn(async (command: string) => {
    task = {
      id: 'quick-one',
      title: command,
      command,
      directory: '/fixtures',
      status: 'running',
      output: '',
    };
    send();
    return task.id;
  });
  const executionCancel = vi.fn(async () => {
    task = { ...task!, status: 'cancelled' };
    send();
  });
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
      runCommand,
      executionCancel,
      executionList: async () => (task ? [task] : []),
      onEvent: (listener: (event: DesktopEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  });
  const space = activeWorkspace();
  const pane = space.panes[0]!;
  const workspace = {
    rootID: () => pane.id,
    openReceipt: vi.fn(),
  } as unknown as WorkspaceController;
  const context: CommandContext = {
    scope: 'folder',
    workspaceID: space.id,
    paneID: pane.id,
    directory: pane.path,
    selection: [],
    clipboard: null,
    jobs: [],
  };
  const mount = (open: boolean) => (
    <WorkspaceContext.Provider value={workspace}>
      <ExecutionPanel />
      {open && (
        <QuickCommand
          context={context}
          initialQuery="printf hello"
          onBack={vi.fn()}
          onClose={vi.fn()}
        />
      )}
    </WorkspaceContext.Provider>
  );
  const view = render(mount(true));
  const input = view.getByRole('textbox', { name: 'Shell command' });
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(runCommand).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  expect(runCommand).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.keyDown(input, { key: 'Enter', repeat: true });
  await waitFor(() => expect(runCommand).toHaveBeenCalledTimes(1));
  expect(runCommand).toHaveBeenCalledWith(
    'printf hello',
    expect.objectContaining({ directory: '/fixtures' }),
  );
  await act(async () => {
    task = { ...task!, output: 'hello' };
    send();
  });
  expect(await view.findByText('hello')).toBeTruthy();
  expect(view.queryByRole('region', { name: 'Command progress' })).toBeNull();
  view.rerender(mount(false));
  expect(executionCancel).not.toHaveBeenCalled();
  await act(async () => {
    task = { ...task!, status: 'completed', exitCode: 0, output: 'hello\nfinished' };
    send();
  });
  view.rerender(mount(true));
  expect(await view.findByText('completed · exit 0')).toBeTruthy();
  expect(view.getByText(/hello\s+finished/)).toBeTruthy();
  expect(runCommand).toHaveBeenCalledTimes(1);
  fireEvent.click(view.getByRole('button', { name: 'Open receipt' }));
  expect(workspace.openReceipt).toHaveBeenCalledWith('quick-one', '/fixtures');
});
