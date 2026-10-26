// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SessionPlane from '../src/renderer/chat/SessionPlane';
import { initialize, activeWorkspace } from '../src/renderer/state/store';
import { SessionsDialog } from '../src/renderer/chat/SessionsDialog';
import type { TaskArea } from '../src/domain/workspaces/tasks';
import { addContentPane } from '../src/renderer/state/panes';
import type { FileEntry } from '../src/domain/contracts';

const workspace = vi.hoisted(() => ({
  open: vi.fn(),
  openGitDiff: vi.fn(async () => {}),
  openTaskMember: vi.fn(async () => 'agent-view'),
  focusPane: vi.fn(),
}));
vi.mock('../src/renderer/workspace/context', () => ({ useWorkspace: () => workspace }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('frames an attached conversation after the modal has restored focus', async () => {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open');
  };
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  const id = crypto.randomUUID();
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
      onEvent: () => () => {},
      chat: vi.fn(async () => []),
      agentSessions: vi.fn(async () => ({
        kind: 'list',
        sessions: [
          {
            id,
            title: 'Review parser',
            clientName: 'Adapter',
            directory: '/fixture',
            updated: 1,
            sequence: 1,
            status: 'waiting',
          },
        ],
      })),
    },
  });
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
  const area: TaskArea = {
    id: crypto.randomUUID(),
    name: 'Task',
    checkout: { path: '/fixture', observed: 1 },
    members: [],
    created: 1,
    updated: 1,
  };
  activeWorkspace().taskAreas = [area];
  const close = vi.fn(() => view.unmount());
  const view = render(<SessionsDialog area={area} onClose={close} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Attach' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(workspace.focusPane).not.toHaveBeenCalled();
  frames.shift()!(0);
  expect(workspace.focusPane).not.toHaveBeenCalled();
  frames.shift()!(16);
  expect(workspace.focusPane).toHaveBeenCalledWith('agent-view', { activate: true });
  expect(activeWorkspace().taskAreas![0]!.members[0]?.title).toBe('Review parser');
});
it('shows exact reported status and opens current referenced files and diffs as linked planes', async () => {
  const file = {
    path: '/fixture/source.ts',
    identity: '1:2',
    modified: 1,
    size: 20,
    directory: false,
  } as FileEntry;
  Object.assign(window, {
    viewer: {
      stat: vi.fn(async () => file),
      save: vi.fn(async () => {}),
      onEvent: () => () => {},
      agentSessions: vi.fn(async () => ({
        kind: 'session',
        session: {
          title: 'Working on parser',
          clientName: 'Named adapter',
          directory: '/fixture',
          sequence: 3,
          updated: 1000,
          status: 'waiting',
          entries: [
            {
              id: 'a',
              role: 'assistant',
              text: 'Ready for review.',
              links: [
                { kind: 'file', path: file.path, line: 4 },
                { kind: 'git-diff', path: file.path },
              ],
            },
          ],
        },
      })),
    },
  });
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
  addContentPane({
    id: 'session',
    type: 'chat',
    path: '/fixture',
    conversationID: crypto.randomUUID(),
    externalSessionID: crypto.randomUUID(),
  });
  render(
    <SessionPlane
      pane={{
        id: 'session',
        type: 'chat',
        path: '/fixture',
        conversationID: 'id',
        externalSessionID: 'id',
      }}
    />,
  );
  expect((await screen.findByText(/^Reported waiting/)).textContent).toContain('Reported waiting');
  fireEvent.click(screen.getByRole('button', { name: 'Open current file: source.ts:4' }));
  await waitFor(() =>
    expect(workspace.open).toHaveBeenCalledWith(
      file,
      'session',
      expect.objectContaining({
        activate: true,
        evidence: expect.objectContaining({ anchor: { kind: 'text', line: 4, start: 0, end: 0 } }),
      }),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Current diff: source.ts' }));
  expect(workspace.openGitDiff).toHaveBeenCalledWith(file.path, 'session');
});
