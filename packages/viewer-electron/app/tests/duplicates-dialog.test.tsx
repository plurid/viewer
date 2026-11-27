// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FileEntry, ViewerAPI } from '../src/domain/contracts';
import type { DuplicateResult } from '../src/domain/comparison/duplicates';
import { DuplicateControls } from '../src/renderer/ui/comparison/Duplicates';
import { sendWindowEvent } from '../src/renderer/app/window-events';
import { flushState, initialize } from '../src/renderer/state/store';
import { measurePathLabels } from './support/path-label-room';
import type { PathLabelRoom } from './support/path-label-room';

const home = '/Users/al';
let room: PathLabelRoom;

const entry = (path: string): FileEntry => ({
  name: path.split('/').pop()!,
  path,
  parent: path.slice(0, path.lastIndexOf('/')),
  extension: path.split('.').pop()!,
  mime: 'application/octet-stream',
  kind: 'file',
  directory: false,
  size: 1000,
  identity: path,
  modified: 1,
  created: 1,
  hidden: false,
});

/** Each group is one way copies end up apart; the heading names the folder they share. */
const groups = {
  oneFolder: [home + '/Pictures/a.jpg', home + '/Pictures/a copy.jpg'],
  siblings: [home + '/Clients/Job 1041/3D/part.dxf', home + '/Clients/Job 1042/3D/part.dxf'],
  homeAndVolume: [home + '/Downloads/x.jpg', '/Volumes/Backup/x.jpg'],
  twoPeople: [home + '/Pictures/y.jpg', '/Users/bo/Pictures/y.jpg'],
  backupYears: ['/Volumes/Backup/2023/z.jpg', '/Volumes/Backup/2024/z.jpg'],
};

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open');
  };
  const result: DuplicateResult = {
    id: 'run',
    roots: [home],
    groups: Object.values(groups).map((paths, index) => ({
      hash: String(index),
      size: 1000,
      files: paths.map(entry),
    })),
    scanned: 10,
    coverage: 'complete',
    errors: [],
    created: 1,
  };
  window.viewer = {
    duplicates: vi.fn(async () => result),
    save: vi.fn(async () => {}),
  } as unknown as ViewerAPI;
  initialize({ home, platform: 'darwin', state: null, locations: [], openPaths: [] });
  room = measurePathLabels(2000);
});
afterEach(async () => {
  cleanup();
  room.remove();
  await flushState(false);
  vi.restoreAllMocks();
});

async function findDuplicates() {
  render(<DuplicateControls />);
  act(() => sendWindowEvent('viewer:duplicates', [home + '/Pictures']));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Find Duplicates$/i }));
  });
  return [...document.querySelectorAll<HTMLElement>('.duplicate-group')];
}

const heading = (group: HTMLElement) =>
  group.querySelector('.duplicate-folder .path-label-text')?.textContent;
const copies = (group: HTMLElement) =>
  [...group.querySelectorAll('.duplicate-file .path-label-text')].map((label) => label.textContent);

it('names the searched folder with ~', async () => {
  await findDuplicates();
  expect(document.body.textContent).toContain('Searches ~/Pictures for files');
});

it('reads copies in one folder by their names under that folder', async () => {
  const [oneFolder] = await findDuplicates();
  expect(heading(oneFolder!)).toBe('~/Pictures');
  expect(copies(oneFolder!)).toEqual(['a.jpg', 'a copy.jpg']);
});

it('reads copies in sibling folders from the folder that tells them apart', async () => {
  const [, siblings] = await findDuplicates();
  expect(heading(siblings!)).toBe('~/Clients');
  expect(copies(siblings!)).toEqual(['Job 1041/3D/part.dxf', 'Job 1042/3D/part.dxf']);
});

it('reads a copy at home and one on a volume from ~ and the root, without a heading', async () => {
  const [, , homeAndVolume] = await findDuplicates();
  expect(heading(homeAndVolume!)).toBeUndefined();
  expect(copies(homeAndVolume!)).toEqual(['~/Downloads/x.jpg', '/Volumes/Backup/x.jpg']);
});

it('reads copies in two people’s folders from ~ and /Users, without a heading', async () => {
  const [, , , twoPeople] = await findDuplicates();
  expect(heading(twoPeople!)).toBeUndefined();
  expect(copies(twoPeople!)).toEqual(['~/Pictures/y.jpg', '/Users/bo/Pictures/y.jpg']);
});

it('reads copies on a volume from the folder they share there', async () => {
  const [, , , , backupYears] = await findDuplicates();
  expect(heading(backupYears!)).toBe('/Volumes/Backup');
  expect(copies(backupYears!)).toEqual(['2023/z.jpg', '2024/z.jpg']);
});

it('discards an old search after reopening and explains a scan limit', async () => {
  let finish!: (value: DuplicateResult) => void;
  const late = new Promise<DuplicateResult>((resolve) => {
    finish = resolve;
  });
  const limited: DuplicateResult = {
    id: 'new',
    roots: [home],
    groups: [],
    scanned: 3,
    coverage: 'partial',
    errors: [],
    created: 1,
    depthLimited: true,
  };
  vi.mocked(window.viewer.duplicates).mockImplementation(async (request) =>
    request.kind === 'cancel' ? null : request.roots[0] === home ? late : limited,
  );
  render(<DuplicateControls />);
  act(() => sendWindowEvent('viewer:duplicates', [home]));
  fireEvent.click(screen.getByRole('button', { name: 'Find Duplicates' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!);
  act(() => sendWindowEvent('viewer:duplicates', [home + '/Pictures']));
  await act(async () => {
    finish({ ...limited, scanned: 999 });
  });
  expect(screen.queryByText(/999 checked/)).toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Find Duplicates' }));
  });
  expect(screen.getByRole('status').textContent).toMatch(/64/);
  expect(screen.getByRole('status').textContent).not.toMatch(/0 items/);
});
