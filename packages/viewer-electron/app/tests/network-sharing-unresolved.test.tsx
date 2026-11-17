// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ViewerAPI } from '../src/domain/contracts';
import { NetworkSharing } from '../src/desktop/files/network-sharing';
import {
  NetworkSharingDialog,
  NetworkSharingSection,
} from '../src/renderer/explorer/NetworkSharing';
import { initialize } from '../src/renderer/state/store';

afterEach(cleanup);
it.each(['dialog', 'info'])(
  'never presents a negative %s answer when the recorded share alias cannot be resolved',
  async (surface) => {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open');
    };
    const path = '/fixtures/Top/Open';
    const alias = '/fixtures/Locked/LinkToOpen';
    const sharing = new NetworkSharing({
      available: true,
      addresses: () => [],
      acl: async () => 'none',
      run: async (kind) => ({
        ok: true,
        stderr: '',
        stdout:
          kind === 'shares'
            ? JSON.stringify({
                Share: {
                  path: alias,
                  smb_name: 'Guest share',
                  smb_shared: 1,
                  smb_guest_access: 1,
                  smb_read_only: 0,
                },
              })
            : '',
      }),
      folder: async (file) => {
        if (file === alias) throw Object.assign(new Error('Locked'), { code: 'EACCES' });
        return { directory: true, mode: 0o755, identity: file, canonical: file };
      },
    });
    const networkSharing: ViewerAPI['networkSharing'] = async (request) =>
      request.kind === 'refresh'
        ? sharing.inspect(request.paths ?? [], request.force)
        : sharing.snapshot();
    Object.assign(window, {
      viewer: { networkSharing, save: vi.fn(async () => {}), copyPaths: vi.fn(async () => {}) },
    });
    initialize({
      home: '/fixtures',
      platform: 'darwin',
      state: null,
      locations: [],
      openPaths: [],
      networkSharingAvailable: true,
    });
    render(
      surface === 'dialog' ? (
        <NetworkSharingDialog path={path} onClose={() => {}} />
      ) : (
        <NetworkSharingSection path={path} />
      ),
    );
    expect(
      await screen.findByText("Viewer couldn't check whether this folder is shared."),
    ).toBeTruthy();
    expect(screen.queryByText('This folder is not shared.')).toBeNull();
  },
);
