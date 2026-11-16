// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FileEntry, ViewerAPI } from '../src/domain/contracts';
import type { NetworkSharingSnapshot } from '../src/domain/files/network-sharing';
import type { CommandContext } from '../src/renderer/commands/registry';
import type { FolderActions } from '../src/renderer/commands/folder';
import type { LineHost } from '../src/renderer/command-line/host';
import type * as WorkspaceModule from '../src/renderer/workspace/context';
import { changePreferences, initialize } from '../src/renderer/state/store';
import { FileInformation } from '../src/renderer/explorer/FileInformation';
import type { FileViewProps } from '../src/renderer/explorer/views';
import type { ColumnNavigation } from '../src/renderer/explorer/column-navigation';
import { ColumnsView, FileIcon, GridView, ListView } from '../src/renderer/explorer/views';
import {
  NetworkSharingDialog,
  NetworkSharingSection,
} from '../src/renderer/explorer/NetworkSharing';
import { readNetworkSharing } from '../src/renderer/explorer/network-sharing-state';
import { Sidebar } from '../src/renderer/ui/navigation/Sidebar';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { folderCommands } from '../src/renderer/commands/folder';
import { useFileDialogs } from '../src/renderer/explorer/FileDialogs';
import { planLine } from '../src/renderer/command-line/run';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({
    count,
    estimateSize,
  }: {
    count: number;
    estimateSize(index: number): number;
  }) => ({
    measure: () => {},
    scrollToIndex: () => {},
    getTotalSize: () => count * estimateSize(0),
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * estimateSize(index),
        size: estimateSize(index),
      })),
  }),
}));

vi.mock('../src/renderer/workspace/context', async (original) => ({
  ...(await original<typeof WorkspaceModule>()),
  useWorkspace: () => ({ rootID: () => undefined }),
}));
const file: FileEntry = {
  path: '/fixtures/Drop folder',
  parent: '/fixtures',
  name: 'Drop folder',
  directory: true,
  kind: 'directory',
  size: 0,
  created: 1,
  modified: 1,
  hidden: false,
  identity: '1:2',
  extension: '',
  mime: 'application/octet-stream',
};
const context = {
  scope: 'files',
  selection: [file],
  workspaceID: '',
  paneID: 'folder',
  clipboard: null,
  jobs: [],
} as CommandContext;
let snapshot: NetworkSharingSnapshot;
const api = vi.fn<ViewerAPI['networkSharing']>();
const copyText = vi.fn(async (_text: string) => {});

beforeEach(async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  snapshot = {
    status: 'ready',
    shares: [
      {
        path: file.path,
        name: 'Drop folder 日本',
        guests: true,
        readOnly: false,
        guestWritable: true,
      },
    ],
    service: 'off',
    host: 'Studio-Mac',
    ipv4: ['10.0.0.3', '192.168.1.12'],
  };
  api.mockReset();
  api.mockImplementation(async () => snapshot);
  Object.assign(window, {
    viewer: {
      networkSharing: api,
      clipboardWriteText: copyText,
      copyPaths: vi.fn(async () => {}),
      clipboardRead: vi.fn(async () => null),
      save: vi.fn(async () => {}),
      folderSizeGet: vi.fn(async () => undefined),
      stat: vi.fn(async () => file),
      fileInformation: vi.fn(async () => ({
        path: file.path,
        identity: file.identity,
        revision: '1',
        tags: [],
        comment: '',
        locked: false,
        mode: 0o777,
        owner: 'Owner',
        group: 'Group',
        allocatedSize: 0,
        package: false,
        readOnly: false,
        canEdit: false,
        metadataSupported: true,
        metadataReadable: true,
        systemTagNames: [],
        alias: false,
      })),
    },
  });
  initialize({
    networkSharingAvailable: true,
    home: '/fixtures',
    platform: 'darwin',
    state: null,
    locations: [{ path: file.path, name: file.name }],
    openPaths: [],
  });
  await readNetworkSharing();
});
afterEach(async () => {
  cleanup();
  await readNetworkSharing();
});

it('marks folders with an accessible name and the strongest guest warning across share names in every file view and sidebar', async () => {
  snapshot = {
    ...snapshot,
    shares: [
      { ...snapshot.shares[0]!, name: 'Registered only', guests: false, guestWritable: false },
      ...snapshot.shares,
    ],
  };
  await readNetworkSharing();
  const { unmount } = render(<FileIcon entry={file} />);
  expect(screen.getByRole('img', { name: 'Shared' }).getAttribute('aria-description')).toContain(
    'Anyone on the same network can open this folder without a password. They can also add, change and delete files in this folder.',
  );
  expect(screen.getByRole('img', { name: 'Shared' }).getAttribute('title')).toContain(
    'Nobody can connect',
  );
  unmount();
  const props: FileViewProps = {
    entries: [file],
    selection: [],
    selectionSet: new Set(),
    showHidden: false,
    select: vi.fn(),
    open: vi.fn(),
    context: vi.fn(),
    drag: vi.fn(),
  };
  const navigation = {
    trail: ['/fixtures'],
    scope: () => [file],
    directory: () => '/fixtures',
    activeDirectory: () => '/fixtures',
    activate: vi.fn(),
  } as unknown as ColumnNavigation;
  for (const content of [
    <ListView {...props} key="list" />,
    <GridView {...props} key="grid" />,
    <ColumnsView {...props} path="/fixtures" navigation={navigation} key="columns" />,
  ]) {
    const view = render(content);
    expect(screen.getByRole('img', { name: 'Shared' })).toBeTruthy();
    view.unmount();
  }
  act(() => changePreferences((ui) => ({ ...ui, sidebar: { ...ui.sidebar, visible: true } })));
  render(<Sidebar />);
  expect(screen.getByRole('img', { name: 'Shared' })).toBeTruthy();
});

it('shows Get Info sharing details and copies literal Windows and encoded Mac addresses', async () => {
  render(<FileInformation entries={[file]} onClose={() => {}} />);
  const section = within(await screen.findByRole('region', { name: 'Network sharing' }));
  expect(section.getByText('Drop folder 日本')).toBeTruthy();
  expect(section.getByText('Registered users and guests')).toBeTruthy();
  expect(section.getByText('File Sharing is off. Nobody can connect to this share.')).toBeTruthy();
  expect(
    section.getByText(
      'Anyone on the same network can open this folder without a password. They can also add, change and delete files in this folder.',
    ),
  ).toBeTruthy();
  const address = 'smb://Studio-Mac.local/Drop%20folder%20%E6%97%A5%E6%9C%AC';
  fireEvent.click(section.getByRole('button', { name: 'Copy Mac address ' + address }));
  await waitFor(() => expect(copyText).toHaveBeenCalledWith(address));
  expect(section.getAllByRole('button', { name: /^Copy Windows address/ })).toHaveLength(3);
});

it('keeps the read-only guest warning visible and omits it for registered users', async () => {
  snapshot = {
    ...snapshot,
    shares: [{ ...snapshot.shares[0]!, readOnly: true, guestWritable: false }],
  };
  await readNetworkSharing();
  const { unmount } = render(<NetworkSharingSection path={file.path} />);
  expect(screen.getByText('Read-only')).toBeTruthy();
  expect(
    screen.getByText('Anyone on the same network can open this folder without a password.'),
  ).toBeTruthy();
  expect(document.querySelector('details')).toBeNull();
  await act(async () => {
    await readNetworkSharing();
  });
  unmount();
  snapshot = { ...snapshot, shares: [{ ...snapshot.shares[0]!, guests: false }] };
  await readNetworkSharing();
  render(<NetworkSharingSection path={file.path} />);
  expect(screen.queryByText(/Anyone on the same network/)).toBeNull();
  expect(screen.getByText('Registered users only')).toBeTruthy();
});

it('has no sharing UI or command in the Store edition or for unknown share points', async () => {
  snapshot = { ...snapshot, status: 'unknown', shares: [] };
  await readNetworkSharing();
  const { unmount } = render(
    <>
      <FileIcon entry={file} />
      <NetworkSharingSection path={file.path} />
    </>,
  );
  expect(screen.queryByRole('img', { name: 'Shared' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Network sharing' })).toBeNull();
  unmount();
  const guidance = render(<NetworkSharingDialog path={file.path} onClose={() => {}} />);
  expect(screen.queryByText(/Sharing status is unknown/)).toBeNull();
  expect(screen.queryByText('This folder is not shared.')).toBeNull();
  guidance.unmount();
  initialize({
    networkSharingAvailable: false,
    home: '/fixtures',
    platform: 'darwin',
    state: null,
    locations: [],
    openPaths: [],
  });
  const command = folderCommands({ networkSharing: vi.fn() } as unknown as FolderActions).find(
    (command) => command.id === 'network-sharing',
  )!;
  expect(command.when(context)).toBe(false);
  render(<NetworkSharingSection path={file.path} />);
  expect(screen.queryByRole('region', { name: 'Network sharing' })).toBeNull();
});

it('opens the captured folder dialog from the command and refreshes it when the person returns', async () => {
  function Host() {
    const dialogs = useFileDialogs();
    return (
      <>
        <button onClick={() => void dialogs.actions.networkSharing?.(context)}>
          Share on the Network…
        </button>
        {dialogs.content}
      </>
    );
  }
  snapshot = { ...snapshot, shares: [] };
  await readNetworkSharing();
  render(<Host />);
  fireEvent.click(screen.getByRole('button', { name: 'Share on the Network…' }));
  expect(await screen.findByText('This folder is not shared.')).toBeTruthy();
  expect(
    screen.getByText(
      /Turn “Allow guest users” off unless you mean to share with everyone on the network/,
    ),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Copy folder path' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open File Sharing Settings' }));
  await waitFor(() => expect(api).toHaveBeenCalledWith({ kind: 'settings', path: file.path }));
  snapshot = {
    ...snapshot,
    service: 'running',
    shares: [
      { path: file.path, name: 'Drop folder', guests: false, readOnly: true, guestWritable: false },
    ],
  };
  act(() => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByText('This folder is shared.')).toBeTruthy();
  expect(screen.getByText('Registered users only')).toBeTruthy();
  expect(screen.getByText('File Sharing is on.')).toBeTruthy();
  expect(screen.getByText('smb://Studio-Mac.local/Drop%20folder')).toBeTruthy();
  snapshot = { ...snapshot, shares: [] };
  act(() => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByText('This folder is not shared.')).toBeTruthy();
});

it('keeps the dialog usable with no local network and an unavailable Settings pane', async () => {
  snapshot = { ...snapshot, ipv4: [] };
  await readNetworkSharing();
  api.mockImplementation(async (request) => {
    if (request.kind === 'settings') throw new Error('Settings unavailable');
    return snapshot;
  });
  render(<NetworkSharingDialog path={file.path} onClose={() => {}} />);
  expect(screen.getByText(/No local network address/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open File Sharing Settings' }));
  expect(await screen.findByText('Settings unavailable')).toBeTruthy();
  expect(screen.queryByLabelText(/password/i)).toBeNull();
});

it('offers the two command names for exactly one folder and refuses custom actions, sequences and named aliases', async () => {
  const opened = vi.fn(async () => {});
  const command = folderCommands({ networkSharing: opened } as unknown as FolderActions).find(
    (command) => command.id === 'network-sharing',
  )!;
  expect(command.when(context)).toBe(true);
  expect(typeof command.label === 'function' && command.label(context)).toBe('Network Sharing…');
  expect(command.when({ ...context, selection: [] })).toBe(false);
  expect(command.when({ ...context, selection: [file, file] })).toBe(false);
  expect(command.when({ ...context, selection: [{ ...file, directory: false }] })).toBe(false);
  snapshot = { ...snapshot, shares: [] };
  await readNetworkSharing();
  expect(typeof command.label === 'function' && command.label(context)).toBe(
    'Share on the Network…',
  );
  const registry = new CommandRegistry();
  registry.register('folder:folder', {
    context: () => context,
    definitions: () => [
      command,
      {
        id: 'custom.direct',
        label: 'Direct',
        group: 'Actions',
        when: () => true,
        run: async () => {
          await registry.invoke('network-sharing', { paneID: 'folder' });
        },
      },
      {
        id: 'custom.sequence',
        label: 'Sequence',
        group: 'Actions',
        when: () => true,
        run: async () => {
          await registry.invoke('custom.direct', { paneID: 'folder' });
        },
      },
    ],
  });
  for (const id of ['custom.direct', 'custom.sequence'])
    await expect(registry.invoke(id, { paneID: 'folder' })).rejects.toThrow('custom action');
  expect(opened).not.toHaveBeenCalled();
  expect(() =>
    planLine('network-sharing', { registry, context: () => context } as LineHost, 1),
  ).toThrow('named command');
  await registry.invoke('network-sharing', { paneID: 'folder' });
  expect(opened).toHaveBeenCalledWith(context);
});
