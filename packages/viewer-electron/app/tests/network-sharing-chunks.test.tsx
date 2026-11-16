// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import type { ViewerAPI } from '../src/domain/contracts';
import { initialize } from '../src/renderer/state/store';
import { readNetworkSharing, sharedFolder } from '../src/renderer/explorer/network-sharing-state';
import { schemas } from '../src/desktop/ipc/schemas';
import type { NetworkSharingSnapshot } from '../src/domain/files/network-sharing';

it('queues a fresh forced response for a new action instead of reusing an older in-flight result', async () => {
  const path = '/fixtures/In flight';
  const empty: NetworkSharingSnapshot = {
    status: 'ready',
    shares: [],
    service: 'running',
    host: '',
    ipv4: [],
    folders: [{ path, status: 'ready', shares: [] }],
  };
  const share = { path, name: 'Guest share', guests: true, readOnly: false, guestWritable: false };
  let release: (value: NetworkSharingSnapshot) => void = () => {};
  const api = vi
    .fn<ViewerAPI['networkSharing']>()
    .mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValue({
      ...empty,
      shares: [share],
      folders: [{ path, status: 'ready', shares: [share] }],
    });
  Object.assign(window, { viewer: { networkSharing: api, save: vi.fn(async () => {}) } });
  initialize({
    home: '/fixtures',
    platform: 'darwin',
    state: null,
    locations: [],
    openPaths: [],
    networkSharingAvailable: true,
  });
  const older = readNetworkSharing([path], true);
  const action = readNetworkSharing([path], true);
  release(empty);
  await older;
  expect((await action).folders?.[0]?.shares).toHaveLength(1);
  expect(api).toHaveBeenCalledTimes(2);
});

it('retains every mark when the window watches more than 1,000 folders', async () => {
  const paths = Array.from({ length: 2001 }, (_, index) => '/fixtures/Folder ' + index);
  const api = vi.fn<ViewerAPI['networkSharing']>(async (request) => {
    expect(schemas.networkSharing.safeParse([request]).success).toBe(true);
    const shares = (request.kind === 'refresh' ? (request.paths ?? []) : []).map((path) => ({
      path,
      name: 'Fixture',
      guests: false,
      readOnly: false,
      guestWritable: false,
    }));
    return {
      status: 'ready',
      shares,
      folders: shares.map((share) => ({ path: share.path, status: 'ready', shares: [share] })),
      service: 'running',
      host: 'Studio-Mac',
      ipv4: [],
    };
  });
  Object.assign(window, { viewer: { networkSharing: api, save: vi.fn(async () => {}) } });
  initialize({
    home: '/fixtures',
    platform: 'darwin',
    state: null,
    locations: [],
    openPaths: [],
    networkSharingAvailable: true,
  });
  const result = await readNetworkSharing(paths, true);
  expect(api).toHaveBeenCalledTimes(3);
  expect(result.folders).toHaveLength(2001);
  expect(paths.every((path) => sharedFolder(path)?.name === 'Fixture')).toBe(true);
});
