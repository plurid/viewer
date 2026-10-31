// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ViewerAPI } from '../src/domain/contracts';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { BackupDialog } from '../src/renderer/persistence/BackupDialog';
import { initialize, flushState } from '../src/renderer/state/store';

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

it('backs up an empty workspace with retained documents without requiring a mounted engine', async () => {
  const backup = vi.fn<ViewerAPI['backup']>(async (request) =>
    request.kind === 'release'
      ? { kind: 'cancelled' }
      : {
          kind: 'review',
          review: {
            id: crypto.randomUUID(),
            mode: 'export',
            created: new Date().toISOString(),
            bytes: 2500,
            workspaces: ['Empty'],
            documents: { notes: 2, drafts: 1, media: 0, conversations: 0, receipts: 0, checks: 0 },
            roots: [],
            warnings: [],
          },
        },
  );
  window.viewer = { backup, save: vi.fn(async () => {}) } as unknown as ViewerAPI;
  initialize({
    home: '/fixtures',
    platform: 'darwin',
    locations: [],
    openPaths: [],
    state: {
      version: 11,
      activeWorkspace: 'empty',
      workspaces: [{ id: 'empty', name: 'Empty', panes: [], roots: [], arrangement: {} }],
      favorites: [],
      recents: [],
      look: 'dark',
    },
  });
  const captureLayout = vi.fn(() => {
    throw new Error('No mounted engine');
  });
  render(
    <BackupDialog
      workspace={{ captureLayout } as unknown as WorkspaceController}
      transition={async (change) => change()}
      onClose={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Create backup…' }));
  await waitFor(() => expect(backup).toHaveBeenCalledWith({ kind: 'prepare-export' }));
  expect(captureLayout).not.toHaveBeenCalled();
  expect(screen.getByText('1 workspace')).toBeTruthy();
  expect(screen.queryByText('0.0 MiB')).toBeNull();
});
