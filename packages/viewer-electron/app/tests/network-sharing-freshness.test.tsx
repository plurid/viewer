// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import type { CommandContext } from '../src/renderer/commands/registry';
import type { ViewerAPI } from '../src/domain/contracts';
import type * as WorkspaceModule from '../src/renderer/workspace/context';
import { entry } from '../src/desktop/files/filesystem';
import { NetworkSharing, sharingFolder } from '../src/desktop/files/network-sharing';
import { FileInformation } from '../src/renderer/explorer/FileInformation';
import { NetworkSharingDialog } from '../src/renderer/explorer/NetworkSharing';
import type { NetworkSharingSnapshot } from '../src/domain/files/network-sharing';
import { useFileDialogs } from '../src/renderer/explorer/FileDialogs';
import { initialize } from '../src/renderer/state/store';
import { readNetworkSharing } from '../src/renderer/explorer/network-sharing-state';
import { temporaryRoot } from '../tools/temporary';

vi.mock('../src/renderer/workspace/context', async (original) => ({
  ...(await original<typeof WorkspaceModule>()),
  useWorkspace: () => ({ rootID: () => undefined }),
}));
afterEach(cleanup);
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});

it('does not flash a cached negative while the forced dialog read is outstanding', async () => {
  const folder = '/fixtures/Pending sharing';
  const empty: NetworkSharingSnapshot = {
    status: 'ready',
    shares: [],
    folders: [{ path: folder, status: 'ready', shares: [] }],
    host: 'Studio-Mac',
    ipv4: [],
    service: 'running',
  };
  const api = vi.fn<ViewerAPI['networkSharing']>(async () => empty);
  Object.assign(window, {
    viewer: { networkSharing: api, save: vi.fn(async () => {}), copyPaths: vi.fn(async () => {}) },
  });
  initialize({
    home: '/fixtures',
    platform: 'darwin',
    state: null,
    locations: [],
    openPaths: [],
    networkSharingAvailable: true,
  });
  await readNetworkSharing([folder]);
  let finish: (snapshot: NetworkSharingSnapshot) => void = () => {};
  api.mockImplementation(
    async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<NetworkSharingDialog path={folder} onClose={() => {}} />);
  expect(screen.getByText('Checking network sharing…')).toBeTruthy();
  expect(screen.queryByText('This folder is not shared.')).toBeNull();
  await act(async () => finish({ ...empty, status: 'unknown' }));
  expect(
    await screen.findByText("Viewer couldn't check whether this folder is shared."),
  ).toBeTruthy();
  expect(screen.queryByText('This folder is not shared.')).toBeNull();
});

it.each(['dialog', 'info'])(
  'refreshes a replaced share root before showing a negative in %s',
  async (surface) => {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open');
    };
    const root = await temporaryRoot('viewer-sharing-replaced-');
    const folder = path.join(root, 'Shared');
    await mkdir(folder);
    const sharing = new NetworkSharing({
      available: true,
      folder: sharingFolder,
      addresses: () => [],
      acl: async () => 'none',
      run: async (read) => ({
        ok: true,
        stderr: '',
        stdout:
          read === 'shares'
            ? JSON.stringify({
                Fixture: {
                  path: folder,
                  smb_name: 'Guest share',
                  smb_shared: 1,
                  smb_guest_access: 1,
                  smb_read_only: 0,
                },
              })
            : read === 'host'
              ? 'Studio-Mac'
              : '',
      }),
    });
    const api = vi.fn<ViewerAPI['networkSharing']>(async (request) =>
      request.kind === 'refresh'
        ? sharing.inspect(request.paths ?? [], request.force)
        : sharing.snapshot(),
    );
    Object.assign(window, {
      viewer: {
        networkSharing: api,
        save: vi.fn(async () => {}),
        folderSizeGet: vi.fn(async () => undefined),
        clipboardRead: vi.fn(async () => null),
        copyPaths: vi.fn(async () => {}),
        fileInformation: vi.fn(async () => {
          throw new Error('Metadata is outside this fixture.');
        }),
      },
    });
    initialize({
      home: root,
      platform: 'darwin',
      state: null,
      locations: [],
      openPaths: [],
      networkSharingAvailable: true,
    });
    await readNetworkSharing([folder]);
    await rename(folder, path.join(root, 'Moved share'));
    await mkdir(folder);
    const file = await entry(folder);
    const context = {
      scope: 'files',
      selection: [file],
      workspaceID: '',
      paneID: 'fixture',
      clipboard: null,
      jobs: [],
    } as CommandContext;
    function Host() {
      const dialogs = useFileDialogs();
      return (
        <>
          <button onClick={() => void dialogs.actions.networkSharing?.(context)}>
            Open sharing
          </button>
          {dialogs.content}
        </>
      );
    }
    if (surface === 'dialog') {
      render(<Host />);
      fireEvent.click(screen.getByRole('button', { name: 'Open sharing' }));
    } else render(<FileInformation entries={[file]} onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByText('Anyone on the same network can open this folder without a password.'),
      ).toBeTruthy(),
    );
    expect(api.mock.calls.some(([request]) => request.kind === 'refresh' && request.force)).toBe(
      true,
    );
    expect(screen.queryByText('This folder is not shared.')).toBeNull();
  },
);
