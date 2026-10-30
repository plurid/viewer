// @vitest-environment jsdom
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { FileEntry, ViewerAPI } from '../src/domain/contracts';
import type { OptimizationCandidate } from '../src/domain/operations/optimization-review';
import { OptimizeDialog } from '../src/renderer/media/OptimizeDialog';
import { flushState, getState, initialize, receiveJob } from '../src/renderer/state/store';

vi.mock('../src/renderer/workspace/context', () => ({
  useWorkspace: () => ({ openPath: vi.fn() }),
}));
HTMLDialogElement.prototype.showModal ??= function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function () {
  this.removeAttribute('open');
};
afterEach(async () => {
  cleanup();
  await flushState(false);
  vi.restoreAllMocks();
});
const files = ['png', 'pdf'].map(
  (extension) =>
    ({
      name: 'source.' + extension,
      path: '/fixture/source.' + extension,
      parent: '/fixture',
      extension,
      mime: 'application/octet-stream',
      kind: 'file',
      directory: false,
      size: 8192,
      identity: extension,
      modified: 1,
      created: 1,
      hidden: false,
    }) as FileEntry,
);
const candidate = (file: FileEntry): OptimizationCandidate => ({
  kind: 'prepared',
  id: randomUUID(),
  source: file,
  format: file.extension === 'pdf' ? 'pdf' : 'image',
  inputBytes: 8192,
  outputBytes: 4096,
});
function setup(optimization: ViewerAPI['optimization']) {
  const cancelJob = vi.fn(async () => {});
  Object.assign(window, {
    viewer: {
      optimization,
      cancelJob,
      release: vi.fn(async () => {}),
      onEvent: vi.fn(() => () => {}),
      save: vi.fn(async () => {}),
      stat: vi.fn(async (path) => files.find((file) => file.path === path)!),
    },
  });
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
  return { cancelJob };
}

it('releases a candidate arriving after cancellation and never starts the next file', async () => {
  let admit!: (value: OptimizationCandidate) => void;
  const optimization = vi.fn<ViewerAPI['optimization']>(async (request) =>
    request.kind === 'prepare'
      ? new Promise((resolve) => {
          admit = resolve;
        })
      : undefined,
  );
  setup(optimization);
  render(createElement(OptimizeDialog, { files, onClose: vi.fn() }));
  fireEvent.click(screen.getByRole('button', { name: 'Prepare candidates' }));
  await waitFor(() =>
    expect(optimization.mock.calls.filter(([request]) => request.kind === 'prepare')).toHaveLength(
      1,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Cancel optimization' }));
  const late = candidate(files[0]!);
  await act(async () => admit(late));
  await waitFor(() =>
    expect(optimization).toHaveBeenCalledWith({ kind: 'release', ids: [late.id] }),
  );
  expect(optimization.mock.calls.filter(([request]) => request.kind === 'prepare')).toHaveLength(1);
});

it('cancels jobs admitted after an export cancellation', async () => {
  let admit!: (value: { kind: 'exported'; jobs: string[]; failures: [] }) => void;
  const optimization = vi.fn<ViewerAPI['optimization']>(async (request) => {
    if (request.kind === 'prepare')
      return candidate(files.find((file) => file.path === request.source)!);
    if (request.kind === 'export')
      return new Promise((resolve) => {
        admit = resolve;
      });
  });
  const { cancelJob } = setup(optimization);
  render(createElement(OptimizeDialog, { files, onClose: vi.fn() }));
  fireEvent.click(screen.getByRole('button', { name: 'Prepare candidates' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Save 2 smaller copies' }));
  await waitFor(() =>
    expect(optimization.mock.calls.some(([request]) => request.kind === 'export')).toBe(true),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Cancel optimization' }));
  await act(async () => admit({ kind: 'exported', jobs: ['late-admission'], failures: [] }));
  await waitFor(() => expect(cancelJob).toHaveBeenCalledWith('late-admission'));
});

it('reads a file as saved when another file of its export failed', async () => {
  const optimization = vi.fn<ViewerAPI['optimization']>(async (request) => {
    if (request.kind === 'prepare')
      return candidate(files.find((file) => file.path === request.source)!);
    if (request.kind === 'export') return { kind: 'exported', jobs: ['export'], failures: [] };
  });
  setup(optimization);
  render(createElement(OptimizeDialog, { files, onClose: vi.fn() }));
  fireEvent.click(screen.getByRole('button', { name: 'Prepare candidates' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Save 2 smaller copies' }));
  await waitFor(() =>
    expect(optimization.mock.calls.some(([request]) => request.kind === 'export')).toBe(true),
  );
  const [image, pdf] = files as [FileEntry, FileEntry];
  // A job in which any item failed has failed, beside the copy it saved.
  act(() =>
    receiveJob({
      id: 'export',
      revision: 1,
      kind: 'convert',
      status: 'failed',
      sources: [image.path, pdf.path],
      bytesDone: 0,
      bytesTotal: 0,
      itemsDone: 2,
      itemsTotal: 2,
      completed: [
        {
          source: image.path,
          destination: '/fixture/Optimized/source.png',
          inputBytes: 8192,
          outputBytes: 4096,
          optimized: true,
        },
      ],
      errors: [{ path: pdf.path, message: 'Generated encoder failure' }],
      errorCount: 1,
      undoable: true,
    }),
  );
  const result = (file: FileEntry) =>
    document.querySelector(`[data-optimization-file="${file.name}"] td:nth-child(5)`)?.textContent;
  await waitFor(() => expect(result(image)).toBe('Saved'));
  expect(result(pdf)).toBe('Generated encoder failure');
});

it('preserves digit-by-digit scan entry and validates before preparing', async () => {
  const optimization = vi.fn<ViewerAPI['optimization']>(async (request) =>
    request.kind === 'prepare' ? candidate(files[1]!) : undefined,
  );
  setup(optimization);
  render(
    createElement(OptimizeDialog, {
      files: [files[1]!],
      initial: 'pdf-for-email',
      onClose: vi.fn(),
    }),
  );
  fireEvent.click(screen.getByText('Quality and dimensions'));
  const input = screen.getByLabelText('PDF maximum image edge') as HTMLInputElement;
  for (const value of ['', '1', '16', '160', '1600']) {
    fireEvent.change(input, { target: { value } });
    expect(input.value).toBe(value);
  }
  fireEvent.change(input, { target: { value: '9000' } });
  expect(screen.getByRole('button', { name: 'Prepare candidates' }).hasAttribute('disabled')).toBe(
    true,
  );
  expect(optimization).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '1600' } });
  fireEvent.click(screen.getByRole('button', { name: 'Prepare candidates' }));
  await waitFor(() =>
    expect(optimization).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'prepare',
        options: expect.objectContaining({ pdfImages: { maximum: 1600 } }),
      }),
    ),
  );
});

it('leaves an unmet target unselected and retries only the chosen file', async () => {
  let fail = true;
  const optimization = vi.fn<ViewerAPI['optimization']>(async (request) => {
    if (request.kind !== 'prepare') return;
    const file = files.find((file) => file.path === request.source)!;
    if (file.extension === 'pdf' && fail) throw new Error('Temporary processor failure');
    const value = candidate(file);
    if (file.extension === 'png')
      value.targetSize = { bytes: 1024, met: false, attempts: 2, quality: 60 };
    return value;
  });
  setup(optimization);
  render(createElement(OptimizeDialog, { files, onClose: vi.fn() }));
  fireEvent.click(screen.getByRole('button', { name: 'Prepare candidates' }));
  await screen.findByText('Temporary processor failure');
  expect(
    (screen.getByRole('checkbox', { name: 'Save source.png' }) as HTMLInputElement).checked,
  ).toBe(false);
  expect(screen.getByText(/Target not met/)).toBeTruthy();
  fail = false;
  const row = screen.getByText('Temporary processor failure').closest('tr')!;
  fireEvent.click(
    [...row.querySelectorAll('button')].find((button) => button.textContent === 'Retry')!,
  );
  await waitFor(() =>
    expect(optimization.mock.calls.filter(([request]) => request.kind === 'prepare')).toHaveLength(
      3,
    ),
  );
  expect(
    optimization.mock.calls.filter(([request]) => request.kind === 'prepare').at(-1)![0],
  ).toMatchObject({ source: files[1]!.path });
  await waitFor(() =>
    expect(
      (screen.getByRole('checkbox', { name: 'Save source.pdf' }) as HTMLInputElement).checked,
    ).toBe(true),
  );
});

it('saves reusable settings without storing selected files or output folders', async () => {
  setup(vi.fn(async () => undefined));
  const settingsPatch = vi.fn<ViewerAPI['settingsPatch']>(async (patches) => ({
    ...getState().settings,
    revision: getState().settings.revision + 1,
    settings: { ...getState().settings.settings, optimizationRecipes: patches[0]!.value as never },
  }));
  Object.assign(window.viewer, { settingsPatch });
  render(createElement(OptimizeDialog, { files, onClose: vi.fn() }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Target size per file' }));
  fireEvent.click(screen.getByText('Saved batch recipes'));
  fireEvent.change(screen.getByLabelText('Optimization recipe name'), {
    target: { value: 'Email under 2 MB' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }));
  await waitFor(() => expect(settingsPatch).toHaveBeenCalledOnce());
  const saved = settingsPatch.mock.calls[0]![0][0]!.value;
  expect(saved).toMatchObject([
    { name: 'Email under 2 MB', options: { targetSize: { bytes: 2_000_000 } } },
  ]);
  expect(JSON.stringify(saved)).not.toContain('/fixture');
});
