import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FileEntry, Pane, SavedState } from '../src/domain/contracts';
import { CURRENT_STATE_VERSION } from '../src/domain/contracts';
import { Storage } from '../src/desktop/persistence/storage';
import {
  attachTaskMember,
  taskReference,
  taskReferenceKey,
  type TaskArea,
} from '../src/domain/workspaces/tasks';
import { taskController } from '../src/renderer/tasks/controller';
import { attachCommandReceipt, attachTaskReference } from '../src/renderer/tasks/state';
import {
  initialize,
  activeWorkspace,
  getState,
  flushState,
  removePanes,
  updatePane,
} from '../src/renderer/state/store';
import { addContentPane } from '../src/renderer/state/panes';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { temporaryRoot } from '../tools/temporary';
import { terminalStartDeferred } from '../src/renderer/terminals/sessions';
import type { AgentTaskBundle } from '../src/domain/agents/task-workflow';
import { loadNote, noteSession } from '../src/renderer/notes/sessions';
afterEach(async () => {
  await flushState(false);
  vi.unstubAllGlobals();
});
function fixture() {
  const documents = new Map<
    string,
    {
      id: string;
      directory: string;
      title: string;
      kind: 'note' | 'checklist';
      text: string;
      revision: number;
      updated: number;
    }
  >();
  const api = {
    save: vi.fn(async () => {}),
    stat: vi.fn(
      async (file: string) =>
        ({ path: file, directory: true, kind: 'directory', identity: '1:2' }) as FileEntry,
    ),
    gitWorktrees: vi.fn(async () => {
      throw new Error('Ordinary folder');
    }),
    notes: vi.fn(
      async (request: {
        kind: string;
        id?: string;
        format?: 'note' | 'checklist';
        directory?: string;
      }) => {
        if (request.kind === 'create') {
          const document = {
            id: randomUUID(),
            directory: request.directory!,
            title: 'Untitled note',
            kind: request.format!,
            text: '',
            revision: 0,
            updated: 1,
          };
          documents.set(document.id, document);
          return { kind: 'document', document };
        }
        return { kind: 'document', document: documents.get(request.id!) };
      },
    ),
    localServerStart: vi.fn(),
    terminalStart: vi.fn(),
    runCommand: vi.fn(),
  };
  vi.stubGlobal('window', { viewer: api, dispatchEvent: vi.fn() });
  initialize({
    home: '/projects/checkout',
    platform: 'darwin',
    state: null,
    locations: [],
    openPaths: [],
  });
  const source = activeWorkspace().panes[0]!;
  const target = {
    workspaceID: activeWorkspace().id,
    rootID: source.id,
    paneID: source.id,
    panePath: source.path,
    directory: source.path,
    selection: [],
  };
  const focus = vi.fn();
  const controller = {
    focusPane: focus,
    rootID: () => source.id,
  } as unknown as WorkspaceController;
  const register = vi.fn((pane: Parameters<typeof addContentPane>[0], _parentID?: string) =>
    addContentPane(pane),
  );
  const waitFor = vi.fn(async (_ids: readonly string[], _workspaceID: string) => {});
  const methods = taskController({
    controller: () => ({ ...controller, ...methods }),
    register,
    waitFor,
    engine: { current: null },
    surface: { current: null },
  });
  return { api, source, target, methods, documents, register, waitFor };
}
it('installs an approved CLI task after canvas mounts, without starting a terminal or reading private notes', async () => {
  const f = fixture(),
    areaID = randomUUID(),
    noteID = randomUUID(),
    terminalID = randomUUID(),
    folderID = randomUUID(),
    overviewID = randomUUID(),
    noteView = randomUUID(),
    gitID = randomUUID();
  if (f.source.type !== 'folder') throw new Error('Generated folder missing');
  const checkout = {
    path: '/projects/checkout/feature',
    identity: '1:7',
    branch: 'feature/cli',
    commit: 'a'.repeat(40),
    observed: 1,
  };
  const bundle: AgentTaskBundle = {
    workspaceID: activeWorkspace().id,
    note: {
      id: noteID,
      directory: checkout.path,
      kind: 'note',
      title: 'Task note',
      text: '',
      revision: 0,
      updated: 1,
    },
    area: {
      id: areaID,
      name: 'CLI task',
      checkout,
      members: [
        {
          id: randomUUID(),
          title: 'Checkout',
          reference: { kind: 'folder', path: checkout.path },
          views: [folderID],
        },
        {
          id: randomUUID(),
          title: 'Note',
          reference: { kind: 'note', path: checkout.path, documentID: noteID },
          views: [noteView],
        },
        {
          id: randomUUID(),
          title: 'Terminal',
          reference: {
            kind: 'terminal',
            path: checkout.path,
            profileID: 'default',
            sessionID: 'session',
          },
          views: [terminalID],
        },
        {
          id: randomUUID(),
          title: 'Git changes',
          reference: { kind: 'git-changes', path: checkout.path },
          views: [gitID],
        },
      ],
      created: 1,
      updated: 1,
    },
    panes: [
      { id: overviewID, type: 'task', path: checkout.path, areaID, title: 'CLI task' },
      { ...f.source, id: folderID, path: checkout.path },
      { id: noteView, type: 'note', path: checkout.path, documentID: noteID, title: 'Task note' },
      {
        id: terminalID,
        type: 'terminal',
        path: checkout.path,
        profileID: 'default',
        taskSessionID: 'session',
      },
      { id: gitID, type: 'git-changes', path: checkout.path, activation: 'manual' },
    ],
  };
  let overviewMounted = false;
  f.register.mockImplementation((pane, parentID) => {
    if (parentID && !overviewMounted) throw new Error('The canvas parent has not mounted');
    return addContentPane(pane);
  });
  f.waitFor.mockImplementation(async () => {
    await Promise.resolve();
    overviewMounted = true;
  });
  await f.methods.installTaskArea(bundle);
  await f.methods.installTaskArea(bundle);
  expect(f.waitFor).toHaveBeenNthCalledWith(1, [overviewID], bundle.workspaceID);
  expect(f.waitFor).toHaveBeenNthCalledWith(
    2,
    bundle.panes.map((pane) => pane.id),
    bundle.workspaceID,
  );
  await loadNote(noteView, noteID);
  expect(noteSession(noteView)?.text).toBe('');
  expect(activeWorkspace().taskAreas).toHaveLength(1);
  expect(
    activeWorkspace().panes.filter((pane) => bundle.panes.some((item) => item.id === pane.id)),
  ).toHaveLength(5);
  expect(terminalStartDeferred(terminalID)).toBe(true);
  expect(f.api.notes).not.toHaveBeenCalled();
  expect(f.api.terminalStart).not.toHaveBeenCalled();
  await flushState();
  expect(f.api.save).toHaveBeenCalled();
});
it('keeps a named area and document reference after closing its views, then reopens a fresh view of the same document', async () => {
  const f = fixture(),
    id = await f.methods.newTaskArea(f.target, 'Implement feature');
  const view = await f.methods.addTaskTool(id, 'note');
  const area = activeWorkspace().taskAreas![0]!,
    member = area.members.find((member) => member.reference.kind === 'note')!;
  const documentID = member.reference.kind === 'note' && member.reference.documentID;
  updatePane(view, { title: 'Task design' });
  expect(
    activeWorkspace().taskAreas![0]!.members.find((value) => value.id === member.id)?.title,
  ).toBe('Task design');
  const overview = activeWorkspace().panes.find((pane) => pane.type === 'task')!;
  removePanes([view, overview.id]);
  expect(activeWorkspace().taskAreas).toHaveLength(1);
  f.methods.openTaskArea(id);
  const reopened = await f.methods.openTaskMember(id, member.id);
  expect(reopened).not.toBe(view);
  const note = activeWorkspace().panes.find((pane) => pane.id === reopened);
  expect(note).toMatchObject({ type: 'note', documentID });
  expect(f.documents.size).toBe(1);
});
it('sets up checkout, note, terminal and Git views once and reopens the same resources on retry', async () => {
  const f = fixture();
  const id = await f.methods.newTaskArea(f.target, 'Branch task');
  await f.methods.setupTaskArea(id);
  const first = activeWorkspace().taskAreas![0]!;
  expect(first.members.map((member) => member.reference.kind).sort()).toEqual([
    'folder',
    'git-changes',
    'note',
    'terminal',
  ]);
  expect(f.documents.size).toBe(1);
  const note = activeWorkspace().panes.find((pane) => pane.type === 'note')!;
  const terminal = activeWorkspace().panes.find((pane) => pane.type === 'terminal')!;
  removePanes([note.id, terminal.id]);
  await f.methods.setupTaskArea(id);
  const next = activeWorkspace().taskAreas![0]!;
  expect(next.members).toHaveLength(4);
  expect(next.members.map((member) => member.reference)).toEqual(
    first.members.map((member) => member.reference),
  );
  expect(f.documents.size).toBe(1);
  expect(f.api.runCommand).not.toHaveBeenCalled();
  expect(f.api.terminalStart).not.toHaveBeenCalled();
});
it('links command receipts only to explicit source-view membership and keeps separate logical terminals', async () => {
  const f = fixture(),
    id = await f.methods.newTaskArea(f.target, 'Task'),
    receiptID = randomUUID();
  attachCommandReceipt(f.target, {
    id: receiptID,
    title: 'git status',
    directory: f.target.directory,
  });
  expect(
    activeWorkspace().taskAreas![0]!.members.some(
      (member) => member.reference.kind === 'receipt' && member.reference.receiptID === receiptID,
    ),
  ).toBe(true);
  attachCommandReceipt(
    { ...f.target, paneID: 'unrelated' },
    { id: randomUUID(), title: 'Unrelated' },
  );
  expect(
    activeWorkspace().taskAreas![0]!.members.filter(
      (member) => member.reference.kind === 'receipt',
    ),
  ).toHaveLength(1);
  await f.methods.addTaskTool(id, 'terminal');
  await f.methods.addTaskTool(id, 'terminal');
  const refs = activeWorkspace().taskAreas![0]!.members.filter(
    (member) => member.reference.kind === 'terminal',
  );
  expect(refs).toHaveLength(2);
  expect(taskReferenceKey(refs[0]!.reference)).not.toBe(taskReferenceKey(refs[1]!.reference));
  expect(f.api.terminalStart).not.toHaveBeenCalled();
  expect(f.api.runCommand).not.toHaveBeenCalled();
  await f.methods.addTaskTool(id, 'server');
  await f.methods.addTaskTool(id, 'server');
  expect(
    activeWorkspace().taskAreas![0]!.members.filter((member) => member.reference.kind === 'server'),
  ).toHaveLength(2);
});
it('keeps the chosen agent conversation title when opening its durable reference', async () => {
  const f = fixture();
  const area = await f.methods.newTaskArea(f.target, 'Task');
  const id = randomUUID();
  window.viewer.agentSessions = vi.fn<typeof window.viewer.agentSessions>(async () => ({
    kind: 'session',
    session: {
      id,
      clientID: 'adapter',
      clientName: 'Adapter',
      externalID: 'external',
      directory: f.target.directory,
      identity: '1:2',
      title: 'Review parser',
      sequence: 1,
      status: 'waiting',
      updated: 1,
      reportHash: 'a'.repeat(64),
      entries: [],
    },
  }));
  attachTaskReference(
    area,
    { kind: 'chat', conversationID: id, externalSessionID: id, path: f.target.directory },
    'Review parser',
  );
  const member = activeWorkspace().taskAreas![0]!.members.find(
    (member) => member.reference.kind === 'chat',
  )!;
  await f.methods.openTaskMember(area, member.id);
  expect(activeWorkspace().taskAreas![0]!.members.find((row) => row.id === member.id)?.title).toBe(
    'Review parser',
  );
});
it('does not retarget an area when its checkout directory identity changes', async () => {
  const f = fixture(),
    id = await f.methods.newTaskArea(f.target, 'Task');
  f.api.stat.mockResolvedValue({
    path: '/projects/checkout',
    directory: true,
    kind: 'directory',
    identity: '1:999',
  } as FileEntry);
  await expect(f.methods.refreshTaskArea(id)).rejects.toThrow('replaced');
  expect(activeWorkspace().taskAreas![0]!.checkout.identity).toBe('1:2');
  await expect(f.methods.addTaskTool(id, 'terminal')).rejects.toThrow('replaced');
});
it('backs up version 9 and persists areas and closed-view references without replay data', async () => {
  const f = fixture(),
    id = await f.methods.newTaskArea(f.target, 'Durable task');
  await f.methods.addTaskTool(id, 'server');
  const root = await temporaryRoot('viewer-task-state-'),
    file = path.join(root, 'state.json'),
    storage = new Storage(file);
  const state = { ...getState().saved, version: 9 } as SavedState,
    original = JSON.stringify(state);
  await writeFile(file, original);
  const loaded = await storage.load();
  expect(loaded.state?.version).toBe(CURRENT_STATE_VERSION);
  const backup = (await readdir(root)).find((name) => name.includes('before-task-areas-v10'))!;
  expect(await readFile(path.join(root, backup), 'utf8')).toBe(original);
  const retained = {
    ...loaded.state!,
    version: CURRENT_STATE_VERSION,
    workspaces: loaded.state!.workspaces.map((space) => ({
      ...space,
      panes: [],
      roots: [],
      activePane: undefined,
      layout: undefined,
    })),
  };
  await storage.save(retained);
  expect((await storage.load()).state?.workspaces[0]?.taskAreas?.[0]?.members).toHaveLength(2);
  expect(f.api.localServerStart).not.toHaveBeenCalled();
});
it('deduplicates document identity across views and bounds membership without mutating the input', () => {
  fixture();
  const id = randomUUID(),
    base: TaskArea = {
      id: randomUUID(),
      name: 'Task',
      created: 1,
      updated: 1,
      checkout: { path: '/repo', observed: 1 },
      members: [],
    };
  const first = attachTaskMember(
    base,
    { kind: 'note', path: '/repo', documentID: id },
    'Notes',
    'one',
  );
  const second = attachTaskMember(
    first,
    { kind: 'note', path: '/moved', documentID: id },
    'Notes',
    'two',
  );
  expect(base.members).toHaveLength(0);
  expect(second.members).toHaveLength(1);
  expect(second.members[0]?.views).toEqual(['one', 'two']);
  expect(
    taskReference({ id: 'scratch', type: 'scratch', path: '/repo', bufferID: id } as Pane),
  ).toBeUndefined();
});
it('keeps server-browser identity across port changes while retaining the route', () => {
  fixture();
  const first = taskReference({
    id: 'browser',
    type: 'browser',
    path: '/repo',
    url: 'http://127.0.0.1:1001/docs',
    serverRuntimeID: 'server',
    serverPath: '/docs',
  } as Pane)!;
  const next = taskReference({
    id: 'new-browser',
    type: 'browser',
    path: '/repo',
    url: 'http://127.0.0.1:2002/docs',
    serverRuntimeID: 'server',
    serverPath: '/docs',
  } as Pane)!;
  expect(taskReferenceKey(first)).toBe(taskReferenceKey(next));
  expect(first).toMatchObject({ serverRuntimeID: 'server', serverPath: '/docs' });
});
