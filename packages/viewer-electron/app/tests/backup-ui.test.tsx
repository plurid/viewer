// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ViewerAPI } from '../src/domain/contracts';
import type { ProjectLayout } from '../src/domain/workspaces/project';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { BackupDialog } from '../src/renderer/persistence/BackupDialog';
import { activeWorkspace, getState, update } from '../src/renderer/state/core';
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
            documents: {
              notes: 2,
              drafts: 1,
              media: 0,
              conversations: 0,
              canvases: 0,
              receipts: 0,
              checks: 0,
            },
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
  fireEvent.click(screen.getByRole('button', { name: 'Create Backup…' }));
  await waitFor(() => expect(backup).toHaveBeenCalledWith({ kind: 'prepare-export' }));
  expect(captureLayout).not.toHaveBeenCalled();
  expect(screen.getByText('1 workspace')).toBeTruthy();
  expect(screen.queryByText('0.0 MiB')).toBeNull();
});

it('captures layout for the backup request without setting space.layout or dirtying a clean project', async () => {
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
            workspaces: ['Project'],
            documents: {
              notes: 0,
              drafts: 0,
              media: 0,
              conversations: 0,
              canvases: 0,
              receipts: 0,
              checks: 0,
            },
            roots: [],
            warnings: [],
          },
        },
  );
  window.viewer = { backup, save: vi.fn(async () => {}) } as unknown as ViewerAPI;
  initialize({ home: '/fixtures', platform: 'darwin', locations: [], openPaths: [], state: null });
  const space = activeWorkspace();
  update({
    ...getState(),
    saved: {
      ...getState().saved,
      workspaces: [
        {
          ...space,
          project: {
            file: '/fixtures/viewer.project.jsonc',
            root: '/fixtures',
            revision: '1',
            dirty: false,
            bindings: {},
            folders: {},
            definition: {
              version: 1,
              id: 'project-1',
              name: 'Project',
              bindings: [],
              planes: [],
              folders: [],
              layout: { placements: [] },
              arrangements: {},
            },
          },
        },
      ],
    },
  });
  const captured: ProjectLayout = {
    placements: [
      {
        id: space.panes[0]!.id,
        location: { translateX: 0, translateY: 0, translateZ: 0, rotateX: 0, rotateY: 0 },
        width: 600,
        height: 400,
        show: true,
      },
    ],
  };
  render(
    <BackupDialog
      workspace={{ captureLayout: () => captured } as unknown as WorkspaceController}
      transition={async (change) => change()}
      onClose={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Create Backup…' }));
  await waitFor(() =>
    expect(backup).toHaveBeenCalledWith({
      kind: 'prepare-export',
      workspaceID: space.id,
      layout: captured,
    }),
  );
  expect(activeWorkspace().layout).toBeUndefined();
  expect(activeWorkspace().project?.dirty).toBe(false);
});
