// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contentPlaneActions } from '../src/renderer/workspace/content-planes';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import type { GitReply } from '../src/domain/comparison/git';
import {
  activeWorkspace,
  flushState,
  getState,
  initialize,
  newWorkspace,
  receiveSettings,
} from '../src/renderer/state/store';
import { addContentPane } from '../src/renderer/state/panes';

beforeEach(() => {
  Object.assign(window, { viewer: { save: vi.fn(async () => {}), stat: vi.fn(), git: vi.fn() } });
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
afterEach(async () => {
  await flushState(false);
});

function fixture() {
  const controller = {
    focusPane: vi.fn<WorkspaceController['focusPane']>(),
    rootID: vi.fn<WorkspaceController['rootID']>(() => 'root'),
    openDiff: vi.fn<WorkspaceController['openDiff']>(),
    open: vi.fn<WorkspaceController['open']>(),
  };
  const registerContent = vi.fn(
    (pane: Parameters<typeof addContentPane>[0], _parentID?: string) => {
      addContentPane(pane, false);
    },
  );
  return {
    controller,
    registerContent,
    actions: contentPlaneActions({ controller: () => controller, registerContent }),
  };
}

describe('Explore', () => {
  const provider = {
    id: 'p',
    name: 'Test model',
    kind: 'openai' as const,
    endpoint: 'https://example.invalid/v1',
    model: 'test',
    allowContent: false,
  };
  const conversation = {
    version: 3,
    id: '6d1c3f9e-2f4b-4a51-9f53-1c9c7f0a2b11',
    title: 'Chat',
    path: '/fixture',
    providerID: 'p',
    scopes: [],
    messages: [],
    draft: '',
    draftRevision: 0,
    revision: 0,
    updated: 0,
    status: 'idle',
    level: 'names',
  };
  beforeEach(() => {
    Object.assign(window.viewer, {
      chat: vi.fn(async () => conversation),
      providerPermissionGet: vi.fn(),
    });
    const current = getState().settings;
    receiveSettings({
      ...current,
      revision: current.revision + 1,
      settings: { ...current.settings, providers: [provider] },
    });
  });
  const sent = () =>
    vi.mocked(window.viewer.chat).mock.calls.filter(([request]) => request.kind === 'send');

  it('sends its request at once when the model may receive names', async () => {
    vi.mocked(window.viewer.providerPermissionGet).mockResolvedValue({
      providerID: 'p',
      kind: 'openai',
      endpoint: provider.endpoint,
      level: 'names',
    });
    await fixture().actions.newChat(['/fixture'], 'Explore what is here', true);
    expect(sent()).toEqual([
      [{ kind: 'send', id: conversation.id, text: 'Explore what is here', providerID: 'p' }],
    ]);
  });

  it('leaves the request as the draft until the person allows the model', async () => {
    vi.mocked(window.viewer.providerPermissionGet).mockResolvedValue(null);
    const view = fixture();
    await view.actions.newChat(['/fixture'], 'Explore what is here', true);
    expect(sent()).toEqual([]);
    expect(window.viewer.chat).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'draft', text: 'Explore what is here' }),
    );
    expect(view.controller.focusPane).toHaveBeenCalled();
  });
});

describe('content-plane opening and reuse', () => {
  it('keeps a server browser attached to its runtime when its address changes', () => {
    const view = fixture();
    const parent = activeWorkspace().panes[0]!;
    view.actions.openBrowser('http://localhost:3000/', parent.id, 'server-runtime');
    const opened = view.registerContent.mock.calls[0]![0];
    expect(opened).toMatchObject({
      type: 'browser',
      path: parent.path,
      serverRuntimeID: 'server-runtime',
    });
    view.actions.openBrowser('http://localhost:3001/', parent.id, 'server-runtime');
    expect(view.registerContent).toHaveBeenCalledOnce();
    expect(view.controller.focusPane).toHaveBeenLastCalledWith(opened.id, { activate: true });
  });

  it('reuses an existing Git changes view without adding a second plane', () => {
    const view = fixture();
    view.actions.openGitChanges('/fixture/repository');
    const opened = view.registerContent.mock.calls[0]![0];
    view.actions.openGitChanges('/fixture/repository');
    expect(view.registerContent).toHaveBeenCalledOnce();
    expect(view.controller.focusPane).toHaveBeenLastCalledWith(opened.id);
  });

  it('does not open a late Git comparison in a different workspace', async () => {
    const view = fixture();
    let resolve!: (value: GitReply) => void;
    vi.mocked(window.viewer.git).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const opening = view.actions.openGitDiff('/fixture/repository/readme.txt');
    await newWorkspace('Another workspace');
    resolve({ kind: 'head', source: null, root: '/fixture/repository' });
    await opening;
    expect(window.viewer.stat).not.toHaveBeenCalled();
    expect(view.controller.openDiff).not.toHaveBeenCalled();
  });

  it('compares a deleted working file against an empty working side', async () => {
    const view = fixture();
    vi.mocked(window.viewer.git).mockResolvedValueOnce({
      kind: 'head',
      source: null,
      root: '/fixture/repository',
    });
    vi.mocked(window.viewer.stat).mockRejectedValueOnce(
      Object.assign(new Error('File missing'), { code: 'ENOENT' }),
    );
    await view.actions.openGitDiff('/fixture/repository/deleted.txt', 'parent');
    expect(view.controller.openDiff).toHaveBeenCalledWith(
      { kind: 'empty', name: 'Absent at HEAD' },
      { kind: 'empty', name: 'Deleted working file' },
      'parent',
    );
  });

  it('preserves the requested parent when opening a new comparison', () => {
    const view = fixture();
    const left = { kind: 'file' as const, path: '/fixture/old.txt' };
    const right = { kind: 'file' as const, path: '/fixture/new.txt' };
    view.actions.openDiff(left, right, 'parent');
    expect(view.registerContent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'diff',
        path: right.path,
        left,
        right,
        mode: 'split',
      }),
      'parent',
    );
  });
});
