import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapturedTarget } from '../src/domain/automation/actions';
import type { FileEntry, FolderPane, Workspace } from '../src/domain/contracts';
import { executeAgentNavigation } from '../src/renderer/workspace/agent-navigation';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { browseSession } from '../src/renderer/workspace/sessions';
import {
  activeWorkspace,
  flushState,
  getState,
  initialize,
  navigate,
  newWorkspace,
  removePanes,
  switchWorkspace,
  updatePane,
} from '../src/renderer/state/store';

const entry = (file: string, directory = false): FileEntry => ({
  path: file,
  parent: file.slice(0, file.lastIndexOf('/')) || '/',
  name: file.split('/').pop()!,
  kind: directory ? 'directory' : 'file',
  directory,
  size: 1,
  extension: directory ? '' : 'txt',
  mime: '',
  modified: 0,
  created: 0,
  hidden: false,
  identity: file,
});
const stat = vi.fn(),
  open = vi.fn(),
  focusPane = vi.fn(),
  rootID = vi.fn(),
  chooseFolder = vi.fn();
const controller = { open, focusPane, rootID } as unknown as WorkspaceController;
const switchTo = vi.fn(async (id: string) => switchWorkspace(id));
const target = (): CapturedTarget => {
  const pane = activeWorkspace().panes[0];
  return {
    workspaceID: activeWorkspace().id,
    paneID: pane.id,
    rootID: pane.id,
    directory: pane.path,
    panePath: pane.path,
    selection: [],
  };
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  stat
    .mockReset()
    .mockImplementation(async (file: string) => entry(file, file === '/shared/Nested'));
  vi.stubGlobal('window', {
    dispatchEvent: vi.fn(),
    viewer: { stat, chooseFolder, save: vi.fn(async () => {}) },
  });
  initialize({ home: '/shared', platform: 'darwin', locations: [], state: null, openPaths: [] });
  rootID.mockImplementation((id: string) => id);
});
afterEach(async () => {
  await flushState(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('workspace agent navigation through existing host records', () => {
  it('focuses a captured destination plane and rejects replacement paths', async () => {
    const captured = target();
    const pane = { id: captured.paneID, type: 'folder' as const, path: captured.panePath! };
    await executeAgentNavigation({ kind: 'focus-plane', pane }, captured, controller, switchTo);
    expect(focusPane).toHaveBeenCalledWith(pane.id);
    await expect(
      executeAgentNavigation(
        { kind: 'focus-plane', pane: { ...pane, path: '/replacement' } },
        captured,
        controller,
        switchTo,
      ),
    ).rejects.toThrow('destination plane changed');
  });
  it('creates a root in an empty workspace and rejects a linked placement with no parent', async () => {
    const captured = target();
    removePanes([captured.paneID]);
    captured.paneID = captured.rootID = 'none';
    delete captured.panePath;
    await executeAgentNavigation(
      { kind: 'open-path', path: '/shared/Nested', placement: 'current' },
      captured,
      controller,
      switchTo,
    );
    expect(open).toHaveBeenCalledWith(entry('/shared/Nested', true), undefined, { another: true });
    await expect(
      executeAgentNavigation(
        { kind: 'open-path', path: '/shared/Nested', placement: 'linked' },
        captured,
        controller,
        switchTo,
      ),
    ).rejects.toThrow('Focus a folder');
    expect(open).toHaveBeenCalledOnce();
  });
  it('navigates the current folder with normal history/focus and never opens a permission picker', async () => {
    const captured = target();
    await executeAgentNavigation(
      { kind: 'open-path', path: '/shared/Nested', placement: 'current' },
      captured,
      controller,
      switchTo,
    );
    expect(activeWorkspace().panes[0]).toMatchObject({
      path: '/shared/Nested',
      history: ['/shared', '/shared/Nested'],
      historyIndex: 1,
    });
    expect(focusPane).toHaveBeenCalledExactlyOnceWith(captured.paneID);
    expect(open).not.toHaveBeenCalled();
    expect(chooseFolder).not.toHaveBeenCalled();
  });
  it.each(['root', 'linked'] as const)(
    'preserves %s placement instead of creating the same linked plane',
    async (placement) => {
      const captured = target();
      await executeAgentNavigation(
        { kind: 'open-path', path: '/shared/Nested', placement },
        captured,
        controller,
        switchTo,
      );
      expect(open).toHaveBeenCalledWith(entry('/shared/Nested', true), captured.paneID, {
        another: placement === 'root',
      });
      expect(activeWorkspace().panes[0].path).toBe('/shared');
    },
  );
  it('opens a current-placement file through the preview controller and surfaces denied access', async () => {
    const captured = target();
    await executeAgentNavigation(
      { kind: 'open-path', path: '/shared/File.txt', placement: 'current' },
      captured,
      controller,
      switchTo,
    );
    expect(open).toHaveBeenCalledWith(entry('/shared/File.txt'), captured.paneID, {
      another: false,
    });
    stat.mockRejectedValueOnce(new Error('Permission revoked'));
    await expect(
      executeAgentNavigation(
        { kind: 'open-path', path: '/shared/Denied.txt', placement: 'root' },
        captured,
        controller,
        switchTo,
      ),
    ).rejects.toThrow('revoked');
    expect(open).toHaveBeenCalledOnce();
    expect(chooseFolder).not.toHaveBeenCalled();
  });
  it('selects exact files and clears selection without mutating the captured file records', async () => {
    const captured = target();
    const files = [entry('/shared/Résumé.txt'), entry('/shared/Two.txt')];
    await executeAgentNavigation({ kind: 'select-files', files }, captured, controller, switchTo);
    expect(browseSession(captured.paneID, '/shared')).toMatchObject({
      selection: files.map((file) => file.path),
      cursor: files[1].path,
      anchor: files[0].path,
    });
    expect(browseSession(captured.paneID, '/shared').cache.get(files[0].path)).toEqual(files[0]);
    await executeAgentNavigation(
      { kind: 'select-files', files: [] },
      captured,
      controller,
      switchTo,
    );
    expect(browseSession(captured.paneID, '/shared')).toMatchObject({
      selection: [],
      cursor: '',
      anchor: '',
    });
    expect(captured.selection).toEqual([]);
  });
  it('supports captured nested column selection and rejects a changed active column', async () => {
    const captured = target();
    updatePane(captured.paneID, { mode: 'columns' } as Partial<FolderPane>);
    const session = browseSession(captured.paneID, captured.panePath!);
    session.columnTrail = ['/shared/Nested'];
    session.columnDirectory = '/shared/Nested';
    captured.directory = '/shared/Nested';
    const file = entry('/shared/Nested/Child.txt');
    await executeAgentNavigation(
      { kind: 'select-files', files: [file] },
      captured,
      controller,
      switchTo,
    );
    expect(session).toMatchObject({
      selection: [file.path],
      columnScope: '/shared/Nested',
      columnDirectory: '/shared/Nested',
    });
    session.columnDirectory = '/shared';
    await expect(
      executeAgentNavigation({ kind: 'select-files', files: [] }, captured, controller, switchTo),
    ).rejects.toThrow('folder changed');
    expect(session.selection).toEqual([file.path]);
  });
  it('checks every identity before publishing a selection and preserves the old selection on failure', async () => {
    const captured = target();
    const session = browseSession(captured.paneID, '/shared');
    session.selection = ['/shared/Old.txt'];
    const first = entry('/shared/First.txt'),
      second = entry('/shared/Second.txt');
    stat.mockResolvedValueOnce(first).mockResolvedValueOnce({ ...second, identity: 'replacement' });
    await expect(
      executeAgentNavigation(
        { kind: 'select-files', files: [first, second] },
        captured,
        controller,
        switchTo,
      ),
    ).rejects.toThrow('selected file changed');
    expect(session.selection).toEqual(['/shared/Old.txt']);
    expect(session.cache.has(first.path)).toBe(false);
  });
  it.each(['workspace', 'closed', 'navigated', 'root-owner'])(
    'rejects an origin that becomes %s while the path is being read',
    async (change) => {
      const captured = target();
      let finish!: (file: FileEntry) => void;
      stat.mockImplementationOnce(
        () =>
          new Promise<FileEntry>((resolve) => {
            finish = resolve;
          }),
      );
      const running = executeAgentNavigation(
        { kind: 'open-path', path: '/shared/Nested', placement: 'root' },
        captured,
        controller,
        switchTo,
      );
      const assertion = expect(running).rejects.toThrow('originating plane');
      if (change === 'workspace') await newWorkspace('Another');
      else if (change === 'closed') removePanes([captured.paneID]);
      else if (change === 'navigated') navigate(captured.paneID, '/other');
      else rootID.mockReturnValueOnce('different-root');
      finish(entry('/shared/Nested', true));
      await assertion;
      expect(open).not.toHaveBeenCalled();
    },
  );
  it('switches only to the reviewed workspace paths and rejects a changed/removed destination', async () => {
    const initial = getState().saved;
    const destination: Workspace = {
      id: 'destination',
      name: 'Downloads',
      panes: [
        {
          ...(activeWorkspace().panes[0] as FolderPane),
          id: 'destination-pane',
          path: '/downloads',
          history: ['/downloads'],
        },
      ],
      roots: ['destination-pane'],
      arrangement: {},
    };
    initialize({
      home: '/shared',
      platform: 'darwin',
      locations: [],
      openPaths: [],
      state: { ...initial, workspaces: [...initial.workspaces, destination] },
    });
    const captured = target();
    const reviewed = {
      id: destination.id,
      name: destination.name,
      roots: destination.roots,
      panes: destination.panes.map((pane) => ({ id: pane.id, type: pane.type, path: pane.path })),
    };
    await expect(
      executeAgentNavigation(
        {
          kind: 'switch-workspace',
          workspace: { ...reviewed, panes: [{ ...reviewed.panes[0], path: '/changed' }] },
        },
        captured,
        controller,
        switchTo,
      ),
    ).rejects.toThrow('destination workspace changed');
    await expect(
      executeAgentNavigation(
        { kind: 'switch-workspace', workspace: { ...reviewed, id: 'deleted' } },
        captured,
        controller,
        switchTo,
      ),
    ).rejects.toThrow('destination workspace changed');
    expect(switchTo).not.toHaveBeenCalled();
    await executeAgentNavigation(
      { kind: 'switch-workspace', workspace: reviewed },
      captured,
      controller,
      switchTo,
    );
    expect(switchTo).toHaveBeenCalledWith('destination');
    expect(activeWorkspace().id).toBe('destination');
  });
});
