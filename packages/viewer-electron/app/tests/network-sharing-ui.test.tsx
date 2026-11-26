// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FileEntry, ViewerAPI } from '../src/domain/contracts';
import type { NetworkSharingSnapshot } from '../src/domain/files/network-sharing';
import { guestWarning } from '../src/domain/files/network-sharing';
import type { CustomAction } from '../src/domain/automation/actions';
import type { CommandContext } from '../src/renderer/commands/registry';
import type { FolderActions } from '../src/renderer/commands/folder';
import type { LineHost } from '../src/renderer/command-line/host';
import type * as WorkspaceModule from '../src/renderer/workspace/context';
import {
  changePreferences,
  getState,
  initialize,
  receiveSettings,
} from '../src/renderer/state/store';
import { programCommands } from '../src/renderer/commands/programs';
import type { WorkspaceController } from '../src/renderer/workspace/context';
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
const offWarning =
  'File Sharing is off, so nobody can connect now. If it is turned on, anyone on the same network will be able to open this folder without a password.';
function reply(paths = [file.path]): NetworkSharingSnapshot {
  return {
    ...snapshot,
    folders: paths.map(
      (path) =>
        snapshot.folders?.find((folder) => folder.path === path) ?? {
          path,
          status: 'ready',
          shares: snapshot.shares.filter((share) => share.path === path),
        },
    ),
  };
}

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
    service: 'running',
    host: 'Studio-Mac',
    ipv4: ['10.0.0.3', '192.168.1.12'],
  };
  api.mockReset();
  api.mockImplementation(async (request) =>
    reply(request.kind === 'refresh' ? request.paths : undefined),
  );
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
  await readNetworkSharing([file.path]);
});
afterEach(async () => {
  cleanup();
  await readNetworkSharing([file.path]);
});

it('marks folders with an accessible name and the strongest guest warning across share names in every file view and sidebar', async () => {
  snapshot = {
    ...snapshot,
    shares: [
      { ...snapshot.shares[0]!, name: 'Registered only', guests: false, guestWritable: false },
      ...snapshot.shares,
    ],
  };
  await readNetworkSharing([file.path]);
  const { unmount } = render(<FileIcon entry={file} />);
  expect(screen.getByRole('img', { name: 'Shared' }).getAttribute('aria-description')).toContain(
    'Anyone on the same network can open this folder without a password. Guests can also modify this folder or its contents.',
  );
  expect(screen.getByRole('img', { name: 'Shared' }).getAttribute('title')).toContain(
    'File Sharing is on',
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
  await screen.findByText('Drop folder 日本');
  const section = within(await screen.findByRole('region', { name: 'Network sharing' }));
  expect(section.getByText('Drop folder 日本')).toBeTruthy();
  expect(section.getByText('Registered users and guests')).toBeTruthy();
  expect(section.getByText('File Sharing is on.')).toBeTruthy();
  expect(
    section.getByText(
      'Anyone on the same network can open this folder without a password. Guests can also modify this folder or its contents.',
    ),
  ).toBeTruthy();
  const address = 'smb://Studio-Mac.local/Drop%20folder%20%E6%97%A5%E6%9C%AC';
  fireEvent.click(section.getByRole('button', { name: 'Copy Mac address ' + address }));
  await waitFor(() => expect(copyText).toHaveBeenCalledWith(address));
  expect(section.getAllByRole('button', { name: /^Copy Windows address/ })).toHaveLength(4);
});

it('keeps the read-only guest warning visible and omits it for registered users', async () => {
  snapshot = {
    ...snapshot,
    shares: [{ ...snapshot.shares[0]!, readOnly: true, guestWritable: false }],
  };
  await readNetworkSharing([file.path]);
  const { unmount } = render(<NetworkSharingSection path={file.path} />);
  expect(await screen.findByText('Read-only')).toBeTruthy();
  expect(
    screen.getByText('Anyone on the same network can open this folder without a password.'),
  ).toBeTruthy();
  expect(document.querySelector('details')).toBeNull();
  await act(async () => {
    await readNetworkSharing([file.path]);
  });
  unmount();
  snapshot = { ...snapshot, shares: [{ ...snapshot.shares[0]!, guests: false }] };
  await readNetworkSharing([file.path]);
  render(<NetworkSharingSection path={file.path} />);
  expect(screen.queryByText(/Anyone on the same network/)).toBeNull();
  expect(await screen.findByText('Registered users only')).toBeTruthy();
});

it('states unknown sharing plainly and has no sharing UI or command in the Store edition', async () => {
  snapshot = { ...snapshot, status: 'unknown', shares: [] };
  await readNetworkSharing([file.path]);
  const { unmount } = render(
    <>
      <FileIcon entry={file} />
      <NetworkSharingSection path={file.path} />
    </>,
  );
  expect(screen.queryByRole('img', { name: 'Shared' })).toBeNull();
  expect(
    await screen.findByText("Viewer couldn't check whether this folder is shared."),
  ).toBeTruthy();
  unmount();
  const guidance = render(<NetworkSharingDialog path={file.path} onClose={() => {}} />);
  expect(
    await screen.findByText("Viewer couldn't check whether this folder is shared."),
  ).toBeTruthy();
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
  await readNetworkSharing([file.path]);
  render(<Host />);
  fireEvent.click(screen.getByRole('button', { name: 'Share on the Network…' }));
  expect(await screen.findByText('This folder is not shared.')).toBeTruthy();
  const primary = await screen.findByRole('button', { name: 'Open File Sharing Settings' });
  await waitFor(() => expect(document.activeElement).toBe(primary));
  expect(
    screen.getByText(/Control-click the folder under Shared Folders, choose Advanced Options/),
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
  await readNetworkSharing([file.path]);
  api.mockImplementation(async (request) => {
    if (request.kind === 'settings') throw new Error('Settings unavailable');
    return reply(request.kind === 'refresh' ? request.paths : undefined);
  });
  render(<NetworkSharingDialog path={file.path} onClose={() => {}} />);
  expect(
    await screen.findByText('smb://Studio-Mac.local/Drop%20folder%20%E6%97%A5%E6%9C%AC'),
  ).toBeTruthy();
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
  await readNetworkSharing([file.path]);
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
        run: async (captured) => {
          await registry.invoke('network-sharing', { paneID: 'folder', context: captured });
        },
      },
      {
        id: 'custom.sequence',
        label: 'Sequence',
        group: 'Actions',
        when: () => true,
        run: async (captured) => {
          await registry.invoke('custom.direct', { paneID: 'folder', context: captured });
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

it('shows inherited sharing and its guest warning, and never calls an unknown folder unshared', async () => {
  const inherited = {
    ...snapshot.shares[0]!,
    path: '/fixtures',
    inside: true,
    relative: file.name,
  };
  snapshot = { ...snapshot, folders: [{ path: file.path, status: 'ready', shares: [inherited] }] };
  await readNetworkSharing([file.path]);
  const mark = render(<FileIcon entry={file} />);
  expect(screen.getByRole('img', { name: 'Shared' }).getAttribute('aria-description')).toContain(
    'Inside the shared folder Drop folder 日本.',
  );
  mark.unmount();
  const info = render(<NetworkSharingSection path={file.path} />);
  expect(await screen.findByText('Inside the shared folder Drop folder 日本')).toBeTruthy();
  expect(
    screen.getByText(/Anyone on the same network can open this folder without a password/),
  ).toBeTruthy();
  info.unmount();
  snapshot = { ...snapshot, folders: [{ path: file.path, status: 'unknown', shares: [] }] };
  await readNetworkSharing([file.path]);
  render(<NetworkSharingDialog path={file.path} onClose={() => {}} />);
  expect(screen.queryByText('This folder is not shared.')).toBeNull();
});

it('lets the person open sharing while an unrelated custom invocation is waiting', async () => {
  let finish = () => {};
  const waiting = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const opened = vi.fn(async () => {});
  const command = folderCommands({ networkSharing: opened } as unknown as FolderActions).find(
    (item) => item.id === 'network-sharing',
  )!;
  const registry = new CommandRegistry();
  registry.register('folder:folder', {
    context: () => context,
    definitions: () => [
      command,
      {
        id: 'custom.wait',
        label: 'Wait',
        group: 'Actions',
        when: () => true,
        run: async () => waiting,
      },
    ],
  });
  const custom = registry.invoke('custom.wait', { paneID: 'folder' });
  try {
    await registry.invoke('network-sharing', { paneID: 'folder' });
    expect(opened).toHaveBeenCalledWith(context);
  } finally {
    finish();
    await custom;
  }
});

it('refuses sharing in actual builtin, plain sequence and command-line custom executors', async () => {
  const invoke = vi.fn(async () => true);
  const line = vi.fn(() => null);
  const executors: CustomAction['executor'][] = [
    { kind: 'builtin', command: 'network-sharing' },
    { kind: 'sequence', commands: ['network-sharing'] },
    { kind: 'sequence', commands: ['network-sharing | copy'] },
  ];
  for (const executor of executors) {
    const settings = structuredClone(getState().settings);
    settings.revision++;
    settings.settings.customActions = [
      {
        id: 'review',
        name: 'Review',
        aliases: [],
        icon: 'command',
        shortcut: '',
        order: 0,
        pinned: false,
        when: { target: 'any', extensions: [], min: 0, max: 10000 },
        executor,
      },
    ];
    act(() => receiveSettings(settings));
    const action = programCommands(
      {} as WorkspaceController,
      invoke,
      undefined,
      () => context,
      line,
    ).find((item) => item.id === 'custom.review')!;
    await expect(action.run({ ...context, directory: '/fixtures' })).rejects.toThrow(
      'custom action',
    );
  }
  expect(invoke).not.toHaveBeenCalled();
  expect(line).not.toHaveBeenCalled();
});

it('uses conditional guest warnings in the mark, Get Info and dialog while File Sharing is off', async () => {
  snapshot = {
    ...snapshot,
    service: 'off',
    shares: [{ ...snapshot.shares[0]!, guestWritable: false }],
  };
  await readNetworkSharing([file.path]);
  const mark = render(<FileIcon entry={file} />);
  expect(screen.getByRole('img', { name: 'Shared' }).getAttribute('aria-description')).toContain(
    offWarning,
  );
  mark.unmount();
  const info = render(<NetworkSharingSection path={file.path} />);
  expect(await screen.findByText(offWarning)).toBeTruthy();
  info.unmount();
  render(<NetworkSharingDialog path={file.path} onClose={() => {}} />);
  expect(await screen.findByText(offWarning)).toBeTruthy();
  snapshot = { ...snapshot, service: 'running' };
  act(() => window.dispatchEvent(new Event('focus')));
  expect(
    await screen.findByText('Anyone on the same network can open this folder without a password.'),
  ).toBeTruthy();
});

it('explains an unavailable build access list and suppresses impossible Windows addresses', async () => {
  snapshot = {
    ...snapshot,
    shares: [
      {
        ...snapshot.shares[0]!,
        relative: 'a\\b',
        guestWritable: false,
        guestWriteUnknown: true,
        guestWriteReason: 'build',
      },
    ],
  };
  await readNetworkSharing([file.path]);
  render(<NetworkSharingSection path={file.path} />);
  expect(await screen.findByText(guestWarning(snapshot.shares[0]!)!)).toBeTruthy();
  expect(screen.getByText(/Windows can’t use this address/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Copy Windows address/ })).toBeNull();
  expect(screen.getByRole('button', { name: /Copy Mac address/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Copy permissions folder path' })).toBeNull();
});

it('shows offline host addresses with a network hint and only adds a distinct guest permission path', async () => {
  snapshot = { ...snapshot, network: 'offline', ipv4: [], interfaces: [] };
  const { unmount } = render(<NetworkSharingDialog path={file.path} onClose={() => {}} />);
  expect(await screen.findByText(/This Mac is not on a network/)).toBeTruthy();
  expect(
    screen.getByText('smb://Studio-Mac.local/Drop%20folder%20%E6%97%A5%E6%9C%AC'),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Copy permissions folder path' })).toBeNull();
  unmount();
  snapshot = {
    ...snapshot,
    shares: [{ ...snapshot.shares[0]!, accessPath: '/fixtures/Canonical folder' }],
  };
  render(<NetworkSharingSection path={file.path} />);
  expect(await screen.findByRole('button', { name: 'Copy permissions folder path' })).toBeTruthy();
});
