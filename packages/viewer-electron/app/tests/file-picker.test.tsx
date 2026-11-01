// @vitest-environment jsdom
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DesktopEvent, FileEntry, ViewerAPI } from '../src/domain/contracts';
import type { DialogReply, FileDialogPrompt, MessageDialogPrompt } from '../src/domain/dialogs';
import FilePicker from '../src/renderer/dialogs/FilePicker';
import { DialogHost } from '../src/renderer/dialogs/DialogHost';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 36,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, start: index * 36, size: 36 })),
    scrollToIndex: vi.fn(),
  }),
}));
HTMLDialogElement.prototype.showModal ??= function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function () {
  this.removeAttribute('open');
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function entry(name: string, directory = false): FileEntry {
  return {
    name,
    path: '/fixture/' + name,
    parent: '/fixture',
    directory,
    extension: name.includes('.') ? name.split('.').at(-1)! : '',
    kind: directory ? 'directory' : 'file',
    mime: 'application/octet-stream',
    size: 40,
    created: 1,
    modified: 1,
    identity: name,
    hidden: name.startsWith('.'),
  };
}
const files = [
  entry('Folder', true),
  entry('First.pdf'),
  entry('Second.pdf'),
  entry('Wrong.txt'),
  entry('.Hidden.pdf'),
];
const prompt = (changes: Partial<FileDialogPrompt> = {}): FileDialogPrompt => ({
  id: randomUUID(),
  kind: 'file',
  mode: 'open',
  title: 'Open documents',
  buttonLabel: 'Open',
  directory: false,
  files: true,
  multiple: true,
  hidden: false,
  folder: '/fixture',
  separator: '/',
  name: '',
  filters: [{ name: 'PDF', extensions: ['pdf'] }],
  places: [],
  ...changes,
});
function setup(handler?: ViewerAPI['dialog'], entries = files) {
  const dialog = vi.fn<ViewerAPI['dialog']>(
    handler ??
      (async (request) =>
        request.kind === 'browse' ? { listing: { path: request.path, parent: '/', entries } } : {}),
  );
  Object.assign(window, { viewer: { dialog } });
  return dialog;
}

it('navigates with the keyboard and selects only supported files with Select All', async () => {
  const dialog = setup(undefined, [...files].reverse());
  const question = prompt();
  render(<FilePicker prompt={question} />);
  await screen.findByRole('option', { name: /First.pdf/ });
  const filter = screen.getByRole('textbox', { name: 'Filter files' });
  expect(document.activeElement).toBe(filter);
  fireEvent.keyDown(filter, { key: 'ArrowDown' });
  const list = screen.getByRole('listbox');
  expect(document.activeElement).toBe(list);
  fireEvent.keyDown(list, { key: 'a', metaKey: true });
  expect(screen.getAllByRole('option', { selected: true })).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  await waitFor(() =>
    expect(dialog).toHaveBeenCalledWith({
      kind: 'choose',
      id: question.id,
      paths: ['/fixture/First.pdf', '/fixture/Second.pdf'],
      replace: false,
    }),
  );
});

it('uses a folder selection for navigation and does not mix it into file ranges', async () => {
  const dialog = setup();
  render(<FilePicker prompt={prompt()} />);
  const folder = await screen.findByRole('option', { name: 'Folder' });
  fireEvent.click(folder);
  fireEvent.click(screen.getByRole('option', { name: /Second.pdf/ }), { shiftKey: true });
  expect(screen.getAllByRole('option', { selected: true })).toHaveLength(2);
  expect(folder.getAttribute('aria-selected')).toBe('false');
  fireEvent.doubleClick(folder);
  await waitFor(() =>
    expect(dialog).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'browse', path: '/fixture/Folder' }),
    ),
  );
});

it('chooses application bundles as files instead of entering their contents', async () => {
  const dialog = setup(undefined, [entry('Editor.app', true)]);
  const question = prompt({
    multiple: false,
    filters: [{ name: 'Applications', extensions: ['app'] }],
  });
  render(<FilePicker prompt={question} />);
  fireEvent.doubleClick(await screen.findByRole('option', { name: 'Editor.app' }));
  await waitFor(() =>
    expect(dialog).toHaveBeenCalledWith({
      kind: 'choose',
      id: question.id,
      paths: ['/fixture/Editor.app'],
      replace: false,
    }),
  );
});

it('chooses the displayed folder after clearing a child selection on blank space', async () => {
  const dialog = setup();
  const question = prompt({
    directory: true,
    files: false,
    multiple: false,
    buttonLabel: 'Choose folder',
  });
  render(<FilePicker prompt={question} />);
  fireEvent.click(await screen.findByRole('option', { name: 'Folder' }));
  expect(screen.getAllByRole('option', { selected: true })).toHaveLength(1);
  fireEvent.click(screen.getByRole('listbox'));
  expect(screen.queryAllByRole('option', { selected: true })).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
  await waitFor(() =>
    expect(dialog).toHaveBeenCalledWith({
      kind: 'choose',
      id: question.id,
      paths: ['/fixture'],
      replace: false,
    }),
  );
});

it('clears hidden selections and ignores stale directory reads', async () => {
  let first!: (reply: DialogReply) => void;
  const dialog = setup(async (request) => {
    if (request.kind !== 'browse') return {};
    if (request.path === '/fixture')
      return new Promise((resolve) => {
        first = resolve;
      });
    return { listing: { path: request.path, parent: '/', entries: [entry('.Hidden.pdf')] } };
  });
  render(<FilePicker prompt={prompt({ hidden: true })} />);
  fireEvent.change(screen.getByLabelText('Folder path'), { target: { value: '/newer' } });
  fireEvent.click(screen.getByRole('button', { name: 'Go' }));
  fireEvent.click(await screen.findByRole('option', { name: /.Hidden.pdf/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Show hidden files' }));
  expect(screen.getByRole('button', { name: 'Open' }).hasAttribute('disabled')).toBe(true);
  await act(async () => first({ listing: { path: '/fixture', parent: '/', entries: files } }));
  expect((screen.getByLabelText('Folder path') as HTMLInputElement).value).toBe('/newer');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() =>
    expect(dialog).toHaveBeenCalledWith(expect.objectContaining({ kind: 'cancel' })),
  );
});

it('focuses the filename and requires a distinct choice after a save conflict', async () => {
  const dialog = setup(async (request) =>
    request.kind === 'browse'
      ? { listing: { path: '/fixture', parent: '/', entries: [] } }
      : request.kind === 'choose' && !request.replace
        ? { conflict: request.paths[0] }
        : {},
  );
  const question = prompt({
    mode: 'save',
    title: 'Save report',
    buttonLabel: 'Save',
    name: 'Report.pdf',
    multiple: false,
  });
  render(<FilePicker prompt={question} />);
  const name = screen.getByLabelText('File name') as HTMLInputElement;
  expect(document.activeElement).toBe(name);
  expect(name.selectionEnd).toBe(6);
  await screen.findByText('This folder is empty');
  fireEvent.keyDown(name, { key: 'Enter' });
  await screen.findByText('/fixture/Report.pdf');
  expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
  expect(dialog.mock.calls.filter(([r]) => r.kind === 'choose')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Replace file' }));
  await waitFor(() =>
    expect(dialog).toHaveBeenCalledWith({
      kind: 'choose',
      id: question.id,
      paths: ['/fixture/Report.pdf'],
      replace: true,
    }),
  );
});

it('keeps a newer desktop prompt when an older handshake or answer completes', async () => {
  let receive!: (event: DesktopEvent) => void;
  let initial!: (reply: DialogReply) => void;
  let answered!: (reply: DialogReply) => void;
  const question: MessageDialogPrompt = {
    id: randomUUID(),
    kind: 'message',
    title: 'Save changes?',
    message: 'Save draft?',
    detail: '',
    buttons: ['Save', 'Don’t Save', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    destructiveId: 1,
  };
  const next = { ...question, id: randomUUID(), title: 'Next question', message: 'Keep reading?' };
  const dialog = setup(
    async (request) =>
      new Promise((resolve) => {
        if (request.kind === 'current') initial = resolve;
        else answered = resolve;
      }),
  );
  Object.assign(window.viewer, {
    onEvent: (listener: typeof receive) => {
      receive = listener;
      return () => {};
    },
  });
  render(<DialogHost />);
  act(() => receive({ type: 'dialog', prompt: question }));
  await act(async () => initial({ prompt: null }));
  expect(screen.getByRole('button', { name: 'Save' }).className).toBe('primary');
  expect(screen.getByRole('button', { name: 'Don’t Save' }).className).toBe('danger');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  act(() => receive({ type: 'dialog', prompt: next }));
  await act(async () => answered({}));
  expect(screen.getByRole('dialog', { name: 'Next question' })).toBeTruthy();
  expect(dialog).toHaveBeenCalledWith({ kind: 'answer', id: question.id, button: 0 });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(dialog).toHaveBeenCalledWith({ kind: 'answer', id: next.id, button: 2 });
});
