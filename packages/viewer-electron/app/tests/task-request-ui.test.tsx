// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TaskWorkflowInput, TaskWorkflowReply } from '../src/domain/agents/task-workflow';
import { TaskRequestDialog } from '../src/renderer/tasks/TaskRequestDialog';
import { activeWorkspace, initialize } from '../src/renderer/state/store';

vi.mock('../src/renderer/ui/ChoiceMenu', () => ({
  ChoiceButton: ({
    label,
    value,
    choices,
    onChoose,
    disabled,
  }: {
    label: string;
    value: string;
    choices: { value: string; label: string }[];
    disabled: boolean;
    onChoose(value: string): void;
  }) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChoose(event.target.value)}
    >
      {choices.map((item) => (
        <option value={item.value} key={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  ),
}));
const create = vi.fn<(input: TaskWorkflowInput) => Promise<TaskWorkflowReply>>();
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  Object.assign(window, { viewer: { save: vi.fn(async () => {}), createTask: create } });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
  create.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const initial = () => ({
  name: 'Ship the feature',
  repo: '/fixtures/repo',
  branch: 'feature/ship',
  path: '/fixtures/Ship',
  workspace: activeWorkspace().id,
});
it('keeps model parameters editable and validates before any desktop request', () => {
  render(<TaskRequestDialog initial={initial()} onClose={() => {}} openFolder={async () => {}} />);
  fireEvent.change(screen.getByLabelText('Task branch'), { target: { value: 'bad..branch' } });
  expect(screen.getByRole('button', { name: 'Create task…' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('status').textContent).toContain('valid local branch');
  fireEvent.change(screen.getByLabelText('Task branch'), { target: { value: 'feature/edited' } });
  expect(screen.getByRole('button', { name: 'Create task…' })).toHaveProperty('disabled', false);
  expect(create).not.toHaveBeenCalled();
});
it('releases the modal for desktop confirmation and restores the same values after cancellation', async () => {
  let finish!: (reply: TaskWorkflowReply) => void;
  create.mockImplementation(
    () =>
      new Promise((done) => {
        finish = done;
      }),
  );
  const close = vi.fn();
  render(<TaskRequestDialog initial={initial()} onClose={close} openFolder={async () => {}} />);
  fireEvent.change(screen.getByLabelText('Task name'), { target: { value: 'Edited task' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create task…' }));
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(document.querySelector('dialog[open]')).toBeNull();
  expect(create.mock.calls[0]![0]).toMatchObject({
    ...initial(),
    name: 'Edited task',
    existing: false,
  });
  await act(async () => finish({ kind: 'cancelled' }));
  expect(screen.getByLabelText('Task name')).toHaveProperty('value', 'Edited task');
  expect(screen.getByLabelText('Task worktree folder')).toHaveProperty('value', initial().path);
  expect(screen.getByRole('alert').textContent).toContain('cancelled');
  expect(close).not.toHaveBeenCalled();
});
it('shows retained output and prevents an accidental retry after partial creation', async () => {
  create.mockResolvedValue({
    kind: 'failed',
    error: 'Canvas unavailable',
    result: {
      workspaceID: activeWorkspace().id,
      taskID: 'fixture',
      path: '/fixtures/Ship',
      branch: 'feature/ship',
      commit: 'fixture-commit',
      stage: 'worktree-created',
      terminal: 'stopped',
    },
  });
  const close = vi.fn(),
    open = vi.fn(async () => {});
  render(<TaskRequestDialog initial={initial()} onClose={close} openFolder={open} />);
  fireEvent.click(screen.getByRole('button', { name: 'Create task…' }));
  await screen.findByRole('button', { name: 'Open retained folder' });
  expect(screen.queryByRole('button', { name: 'Create task…' })).toBeNull();
  expect(screen.getByLabelText('Task worktree folder')).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Open retained folder' }));
  await waitFor(() => expect(open).toHaveBeenCalledWith('/fixtures/Ship'));
  expect(close).toHaveBeenCalledOnce();
});
