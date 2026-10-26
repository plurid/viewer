// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import GitChanges from '../src/renderer/git/GitChanges';
import { activeWorkspace, flushState, initialize } from '../src/renderer/state/store';
import { addContentPane } from '../src/renderer/state/panes';
import type { ViewerAPI } from '../src/domain/contracts';

const workspace = vi.hoisted(() => ({
  rootID: () => 'review',
  openGitDiff: vi.fn(async () => {}),
}));
vi.mock('../src/renderer/workspace/context', () => ({ useWorkspace: () => workspace }));
const api = vi.fn<ViewerAPI['gitReview']>();
beforeEach(() => {
  api.mockReset();
  Object.assign(window, { viewer: { save: vi.fn(async () => {}), gitReview: api } });
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
  addContentPane({ id: 'review', type: 'git-changes', path: '/fixture' });
  api.mockImplementation(async (request) => {
    if (request.kind === 'open')
      return {
        kind: 'opened',
        reviewID: 'lease',
        branches: [{ id: 'base', name: 'main', commit: 'a'.repeat(40) }],
        defaultBaseID: 'base',
      };
    if (request.kind === 'read')
      return {
        kind: 'snapshot',
        snapshot: {
          id: 'snapshot',
          mode: request.mode,
          root: '/fixture',
          branch: 'feature',
          files: [
            { id: 'first', path: 'a.txt', status: 'M' },
            { id: 'second', path: 'b.txt', status: 'M' },
          ],
        },
      };
    if (request.kind === 'file')
      return {
        kind: 'file',
        file: {
          id: 'file-' + request.fileID,
          snapshotID: 'snapshot',
          path: request.fileID === 'first' ? 'a.txt' : 'b.txt',
          hunks: [
            { id: 'hunk-' + request.fileID, heading: '@@ -1 +1 @@', lines: ['-before', '+after'] },
          ],
        },
      };
    return request.kind === 'apply' ? { kind: 'applied' } : { kind: 'released' };
  });
});
afterEach(async () => {
  cleanup();
  await flushState(false);
});

it('retains file selection and mode, stages only the chosen hunk and navigates files by keyboard', async () => {
  const view = render(<GitChanges path="/fixture" paneID="review" />);
  await screen.findByRole('button', { name: 'Stage hunk 1' });
  fireEvent.keyDown(screen.getByRole('region', { name: 'Git review' }), {
    key: 'ArrowDown',
    altKey: true,
  });
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(expect.objectContaining({ kind: 'file', fileID: 'second' })),
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Stage hunk 1' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith({
      kind: 'apply',
      reviewID: 'lease',
      fileID: 'file-second',
      hunks: ['hunk-second'],
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Staged' }));
  await screen.findByRole('button', { name: 'Unstage hunk 1' });
  expect(activeWorkspace().panes.find((pane) => pane.id === 'review')).toMatchObject({
    review: { mode: 'staged', selectedPath: 'b.txt' },
  });
  view.unmount();
  render(<GitChanges path="/fixture" paneID="review" />);
  await screen.findByRole('button', { name: 'Unstage hunk 1' });
  expect(api.mock.calls.filter(([request]) => request.kind === 'file').at(-1)?.[0]).toMatchObject({
    fileID: 'second',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Against base' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'read', mode: 'branch', baseID: 'base' }),
    ),
  );
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: /(?:Stage|Unstage) hunk/ })).toBeNull(),
  );
});
