// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ViewerAPI } from '../src/domain/contracts';
import type { NetworkSharingSnapshot } from '../src/domain/files/network-sharing';
import {
  NetworkSharingDialog,
  NetworkSharingSection,
  SharedMark,
} from '../src/renderer/explorer/NetworkSharing';
import { initialize } from '../src/renderer/state/store';

afterEach(cleanup);
it.each(['dialog', 'info'])(
  'checks only the %s folder without waiting for forty watched rows',
  async (surface) => {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open');
    };
    const path = '/fixtures/Selected';
    const paths = Array.from({ length: 40 }, (_, index) => '/fixtures/Row ' + index);
    const share = {
      path,
      name: 'Guest share',
      guests: true,
      readOnly: false,
      guestWritable: false,
    };
    const empty: NetworkSharingSnapshot = {
      status: 'ready',
      shares: [],
      service: 'running',
      host: 'Studio-Mac',
      ipv4: [],
    };
    let finish: () => void = () => {};
    const api = vi.fn<ViewerAPI['networkSharing']>(async (request) => {
      const requested = request.kind === 'refresh' ? (request.paths ?? []) : [];
      if (requested.length > 1)
        return new Promise((resolve) => {
          finish = () =>
            resolve({
              ...empty,
              folders: requested.map((path) => ({ path, status: 'ready', shares: [] })),
            });
        });
      return { ...empty, shares: [share], folders: [{ path, status: 'ready', shares: [share] }] };
    });
    Object.assign(window, {
      viewer: {
        networkSharing: api,
        save: vi.fn(async () => {}),
        copyPaths: vi.fn(async () => {}),
      },
    });
    initialize({
      home: '/fixtures',
      platform: 'darwin',
      state: null,
      locations: [],
      openPaths: [],
      networkSharingAvailable: true,
    });
    try {
      render(
        <>
          {paths.map((path) => (
            <SharedMark key={path} path={path} />
          ))}
        </>,
      );
      await waitFor(() =>
        expect(
          api.mock.calls.some(
            ([request]) => request.kind === 'refresh' && request.paths?.length === 40,
          ),
        ).toBe(true),
      );
      render(
        surface === 'dialog' ? (
          <NetworkSharingDialog path={path} onClose={() => {}} />
        ) : (
          <NetworkSharingSection path={path} />
        ),
      );
      await waitFor(
        () =>
          expect(
            api.mock.calls.some(
              ([request]) =>
                request.kind === 'refresh' &&
                request.force &&
                request.paths?.length === 1 &&
                request.paths[0] === path,
            ),
          ).toBe(true),
        { timeout: 100 },
      );
      expect(
        await screen.findByText(
          'Anyone on the same network can open this folder without a password.',
        ),
      ).toBeTruthy();
    } finally {
      await act(async () => finish());
    }
    expect(screen.queryByText('This folder is not shared.')).toBeNull();
    expect(
      screen.getByText('Anyone on the same network can open this folder without a password.'),
    ).toBeTruthy();
  },
);
