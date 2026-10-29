// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, useState } from 'react';
import { gitCommitMessageLimit } from '../src/domain/comparison/git-actions';
import { CommitDialog } from '../src/renderer/git/CommitDialog';
import { WindowDialogs, type WindowDialog } from '../src/renderer/app/WindowDialogs';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { initialize } from '../src/renderer/state/store';

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
};
afterEach(cleanup);

function mount(onSubmit = vi.fn<(message: string) => Promise<void>>(async () => {})) {
  const onClose = vi.fn();
  const view = render(
    createElement(CommitDialog, { directory: '/fixture/subfolder', onSubmit, onClose }),
  );
  return {
    ...view,
    field: screen.getByRole('textbox', { name: 'Commit message' }) as HTMLTextAreaElement,
    submit: screen.getByRole('button', { name: 'Commit staged changes' }) as HTMLButtonElement,
    form: screen.getByRole('form', { name: 'Git commit' }),
    onSubmit,
    onClose,
  };
}

describe('staged Git commit message dialog', () => {
  it('identifies the completed request when replacement and completion share a React batch', async () => {
    Object.assign(window, { viewer: { save: vi.fn(async () => {}) } });
    initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
    let finish!: () => void;
    let replace!: () => void;
    const target = {
      workspaceID: 'work',
      rootID: 'folder',
      paneID: 'folder',
      panePath: '/fixture',
      directory: '/fixture',
      selection: [],
    };
    const first: WindowDialog = { type: 'git-commit', id: 'first', target };
    const replacement: WindowDialog = { type: 'git-commit', id: 'replacement', target };
    const closed = vi.fn();
    const workspace = {
      newGitAction: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    } as unknown as WorkspaceController;
    function Host() {
      const [dialog, setDialog] = useState<WindowDialog | undefined>(first);
      replace = () => setDialog(replacement);
      return createElement(WindowDialogs, {
        dialog,
        workspace,
        transitionWorkspace: (change) => change(),
        onClose: (expected) => {
          closed(expected);
          setDialog((current) => (current === expected ? undefined : current));
        },
      });
    }
    render(createElement(Host));
    // the window's dialogs load their code as they first open
    fireEvent.change(await screen.findByRole('textbox', { name: 'Commit message' }), {
      target: { value: 'First request only' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Commit staged changes' }));
    await act(async () => {
      replace();
      finish();
    });
    expect(closed).toHaveBeenCalledWith(first);
    expect(
      (screen.getByRole('textbox', { name: 'Commit message' }) as HTMLTextAreaElement).value,
    ).toBe('');
    expect(screen.getByRole('dialog', { name: 'Commit staged changes' })).toBeTruthy();
  });

  it('isolates replacement requests from the same plane in the actual window dialog owner', async () => {
    Object.assign(window, { viewer: { save: vi.fn(async () => {}) } });
    initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
    let finish!: () => void;
    const workspace = {
      newGitAction: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    } as unknown as WorkspaceController;
    const onClose = vi.fn();
    const target = {
      workspaceID: 'work',
      rootID: 'folder',
      paneID: 'folder',
      panePath: '/fixture',
      directory: '/fixture',
      selection: [],
    };
    const prompt = (id: string, directory: string) =>
      createElement(WindowDialogs, {
        dialog: { type: 'git-commit', id, target: { ...target, directory } } satisfies WindowDialog,
        onClose,
        workspace,
        transitionWorkspace: (change) => change(),
      });
    const view = render(prompt('first', '/fixture'));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Commit message' }), {
      target: { value: 'Belongs to the first request' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Commit staged changes' }));
    view.rerender(prompt('replacement', '/fixture/other'));
    expect(
      (screen.getByRole('textbox', { name: 'Commit message' }) as HTMLTextAreaElement).value,
    ).toBe('');
    expect(screen.getByText('/fixture/other')).toBeTruthy();
    await act(async () => finish());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Commit staged changes' })).toBeTruthy();
  });

  it('states staged-only scope, focuses the multiline message and rejects an empty message', () => {
    const view = mount();
    expect(screen.getByRole('dialog', { name: 'Commit staged changes' })).toBeTruthy();
    expect(
      screen.getByText(
        'Commit only changes already staged in the repository containing this folder.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('/fixture/subfolder')).toBeTruthy();
    expect(document.activeElement).toBe(view.field);
    expect(view.field.rows).toBe(6);
    expect(view.field.maxLength).toBe(gitCommitMessageLimit);
    expect(view.submit.disabled).toBe(true);
    fireEvent.change(view.field, { target: { value: '\n  \n' } });
    fireEvent.submit(view.form);
    expect(view.onSubmit).not.toHaveBeenCalled();
  });

  it('passes the exact multiline message once and waits for the handoff before closing', async () => {
    let finish!: () => void;
    const pending = vi.fn<(message: string) => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const view = mount(pending);
    const message = 'Keep a concise subject\n\nExplain the change in the body.\n';
    fireEvent.change(view.field, { target: { value: message } });
    fireEvent.click(view.submit);
    fireEvent.submit(view.form);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(pending).toHaveBeenCalledExactlyOnceWith(message);
    expect(view.field.disabled).toBe(true);
    expect(view.onClose).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(view.onClose).toHaveBeenCalledTimes(1);
  });

  it('retains the message after an error and permits a successful retry', async () => {
    const onSubmit = vi
      .fn<(message: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('The repository is busy. Try again.'))
      .mockResolvedValue(undefined);
    const view = mount(onSubmit);
    fireEvent.change(view.field, { target: { value: 'A reviewed staged change' } });
    fireEvent.click(view.submit);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'The repository is busy. Try again.',
    );
    expect(view.field.value).toBe('A reviewed staged change');
    expect(view.field.disabled).toBe(false);
    expect(view.onClose).not.toHaveBeenCalled();
    fireEvent.click(view.submit);
    await waitFor(() => expect(view.onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('cancels without submitting or persisting the message', () => {
    const view = mount();
    fireEvent.change(view.field, { target: { value: 'A transient message' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(view.onSubmit).not.toHaveBeenCalled();
    expect(view.onClose).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(mount().field.value).toBe('');
  });

  it('enforces the length limit even when a programmatic event bypasses maxlength', () => {
    const view = mount();
    fireEvent.change(view.field, { target: { value: 'x'.repeat(gitCommitMessageLimit + 1) } });
    fireEvent.submit(view.form);
    expect(view.submit.disabled).toBe(true);
    expect(view.onSubmit).not.toHaveBeenCalled();
  });

  it('keeps Enter for newlines and avoids submitting an IME composition', async () => {
    const view = mount();
    fireEvent.change(view.field, { target: { value: 'A commit message' } });
    fireEvent.keyDown(view.field, { key: 'Enter' });
    fireEvent.keyDown(view.field, { key: 'Enter', ctrlKey: true, isComposing: true });
    expect(view.onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(view.field, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(view.onClose).toHaveBeenCalledTimes(1));
    expect(view.onSubmit).toHaveBeenCalledExactlyOnceWith('A commit message');
  });

  it('does not close a later dialog when an unmounted prompt finishes', async () => {
    let finish!: () => void;
    const view = mount(
      vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    fireEvent.change(view.field, { target: { value: 'Already handed off' } });
    fireEvent.click(view.submit);
    view.unmount();
    const later = mount();
    await act(async () => finish());
    expect(view.onClose).not.toHaveBeenCalled();
    expect(later.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Commit staged changes' })).toBeTruthy();
  });
});
