// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { temporaryRoot } from '../tools/temporary';
import { entry } from '../src/desktop/files/filesystem';
import { FileInformationService } from '../src/desktop/files/file-information';
import { FileInformation } from '../src/renderer/explorer/FileInformation';
import { initialize } from '../src/renderer/state/workspaces';

vi.mock('electron', () => ({ shell: {} }));
const { createFileHandlers } = await import('../src/desktop/ipc/file-handlers');
afterEach(cleanup);

it('keeps the selected link identity and spelling through stat and Get Info', async () => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  const root = await temporaryRoot('viewer-history-stat-');
  const folder = path.join(root, 'Real');
  const link = path.join(root, 'Link');
  await mkdir(folder);
  await symlink(folder, link);
  const selected = await entry(link);
  const information = new FileInformationService(async () => {}, () => {});
  const handlers = createFileHandlers({
    fileAccess: { require: async () => {} },
    information,
    files: {} as never,
    watchers: {} as never,
  });
  const latest = await handlers.stat([link], 1);
  expect(latest).toMatchObject({ path: link, kind: 'symlink', identity: selected.identity });
  Object.assign(window, { viewer: {
    stat: (file: string) => handlers.stat([file], 1),
    fileInformation: (file: string) => information.get(file),
    save: async () => {},
    folderSizeGet: async () => undefined,
  } });
  initialize({ home: root, platform: 'darwin', state: null, locations: [], openPaths: [] });
  try {
    render(<FileInformation entries={[selected]} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit information' }));
    await waitFor(() => expect(screen.getByText('Owner')).toBeTruthy());
    expect(screen.queryByText(/This item was replaced/)).toBeNull();
    expect(screen.getByText('Owner')).toBeTruthy();
  } finally {
    await information.close();
  }
});
