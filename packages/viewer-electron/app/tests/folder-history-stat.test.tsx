// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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

async function fixture() {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  const root = await temporaryRoot('viewer-history-stat-');
  const folder = path.join(root, 'Real');
  const link = path.join(root, 'Link');
  await mkdir(folder);
  await symlink(folder, link);
  const selected = await entry(link);
  const information = new FileInformationService(
    async () => {},
    () => {},
  );
  const handlers = createFileHandlers({
    fileAccess: { require: async () => {} },
    information,
    files: {} as never,
    watchers: {} as never,
  });
  return { root, folder, link, selected, information, handlers };
}

it('keeps the selected link identity and spelling through stat', async () => {
  const { link, selected, information, handlers } = await fixture();
  try {
    expect(await handlers.stat([link], 1)).toMatchObject({
      path: link,
      kind: 'symlink',
      identity: selected.identity,
    });
  } finally {
    await information.close();
  }
});

it('opens Get Info for a folder link itself without replacement errors', async () => {
  const { root, link, information, handlers } = await fixture();
  Object.assign(window, {
    viewer: {
      stat: (file: string) => handlers.stat([file], 1),
      fileInformation: (file: string) => information.get(file),
      save: async () => {},
      folderSizeGet: async () => undefined,
    },
  });
  initialize({ home: root, platform: 'darwin', state: null, locations: [], openPaths: [] });
  try {
    render(<FileInformation entries={[await window.viewer.stat(link)]} onClose={() => {}} />);
    expect(screen.getByText('Target')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/This item was replaced/)).toBeNull();
  } finally {
    await information.close();
  }
});
