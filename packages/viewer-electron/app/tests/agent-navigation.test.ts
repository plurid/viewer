import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, realpath, rename, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentNavigation, AgentWorkspaceSnapshot } from '../src/domain/agents/requests';
import type { CapturedTarget } from '../src/domain/automation/actions';
import { AgentBroker } from '../src/desktop/agents/agent-broker';
import { AgentSessions } from '../src/desktop/agents/sessions';
import { AgentRequests } from '../src/desktop/agents/agent-requests';
import type { AgentAccessChange } from '../src/desktop/agents/agent-access';
import { SettingsService } from '../src/desktop/preferences/settings';
import type { FileServices } from '../src/desktop/files/file-services';
import type { ActionPlanner } from '../src/desktop/actions/planner';
import type { ActionPlan, ActionRequest } from '../src/domain/services';
import type { FileRelation } from '../src/domain/files/relationships';
import { readDrawingGeometry } from '../src/desktop/previews/drawing-geometry';
import { panelDrawing } from './dxf-fixtures';
import { officeFixture } from './office-fixtures';
import { extractDocument } from '../src/desktop/previews/formats';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import type * as Coordination from '../src/desktop/files/file-coordination';
import { entry } from '../src/desktop/files/filesystem';

// These service regressions exercise authorization, real readers and parsers. Native provider
// coordination has its own acceptance; an OS prompt must not decide the broker's unit results.
vi.mock('../src/desktop/files/file-coordination', async (importOriginal) => {
  const original = await importOriginal<typeof Coordination>();
  return {
    ...original,
    fileCoordination: new original.FileCoordination(() => ({
      coordinateStart: async (_id, intents) => intents.map((intent) => intent.path),
      coordinateEnd: async () => {},
      coordinateCancel: () => {},
      coordinateSameItem: () => false,
    })),
  };
});

let root: string, files: string, secret: string, token: string;
let settings: SettingsService, broker: AgentBroker, requests: AgentRequests;
let sessions: AgentSessions;
let catalog: { target: CapturedTarget; commands: [] } | undefined;
let snapshot: AgentWorkspaceSnapshot;
let denied: boolean;
let actionTasks: ActionPlan[];
let relationshipRows: FileRelation[];
const queryFiles = vi.fn<FileServices['query']>();
const startAction = vi.fn(async (request: ActionRequest) => {
  const id = crypto.randomUUID();
  actionTasks.push({
    version: 1,
    id,
    revision: 1,
    title: 'Generated task',
    recipeID: request.recipeID,
    context: request.context,
    status: 'review',
    rows: [],
    undoable: false,
  });
  return id;
});
const navigate = vi.fn<(request: AgentNavigation, target: CapturedTarget) => Promise<void>>();
const plane = (id: string, file: string) => ({
  id,
  type: 'folder' as const,
  path: file,
  mode: 'list' as const,
});
const call = async <T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
  const result = (await broker.handle(token, {
    method: 'tools/call',
    params: { name, arguments: args },
  })) as { content: { text: string }[] };
  return JSON.parse(result.content[0].text) as T;
};
const allowAgentAccess = async (change: AgentAccessChange) =>
  broker.access.approve(change, await broker.access.captureReview(change));
beforeEach(async () => {
  actionTasks = [];
  relationshipRows = [];
  startAction.mockClear();
  queryFiles.mockReset();
  root = await temporaryRoot('viewer-agent-navigation-');
  files = path.join(root, 'Shared');
  secret = path.join(root, 'Private');
  await mkdir(files);
  await mkdir(secret);
  await writeFile(path.join(files, 'Résumé.txt'), 'Generated selection.');
  const data = path.join(root, 'profile');
  settings = new SettingsService(
    data,
    files,
    () => false,
    () => {},
  );
  await settings.load();
  await settings.patch(
    [{ path: 'settings.agents', value: { enabled: true, roots: [files], allowLayout: false } }],
    settings.snapshot().revision,
  );
  denied = false;
  catalog = {
    target: {
      workspaceID: 'origin',
      rootID: 'folder',
      paneID: 'folder',
      panePath: files,
      directory: files,
      selection: [],
    },
    commands: [],
  };
  snapshot = {
    activeWorkspace: 'origin',
    workspaces: [
      {
        id: 'origin',
        name: 'Origin',
        panes: [
          plane('folder', files),
          plane('private-plane', secret),
          { id: 'global', type: 'search', path: files, allLocations: true },
        ],
        roots: ['folder', 'private-plane', 'global'],
      },
      {
        id: 'destination',
        name: 'Downloads',
        panes: [plane('destination-folder', files)],
        roots: ['destination-folder'],
      },
      {
        id: 'private',
        name: 'Private workspace',
        panes: [plane('secret', secret)],
        roots: ['secret'],
      },
      { id: 'empty', name: 'Empty', panes: [], roots: [] },
    ],
  };
  navigate
    .mockReset()
    .mockImplementation(async (request, target) => broker.authorizeNavigation(request, target));
  requests = new AgentRequests(
    data,
    settings,
    () => {},
    async () => {},
    { read: () => ({ cwd: files, output: '' }) },
    navigate,
    {
      actor: () => broker.clients.actor(),
      check: (proposal) => broker.authorizeProposal(proposal),
      run: (id, work) => broker.clients.context.run(id, work),
      cancelExecution: () => {},
    },
  );
  sessions = new AgentSessions(data, () => {});
  broker = new AgentBroker(
    data,
    () => settings.snapshot().settings,
    () =>
      catalog
        ? {
            workspaceID: catalog.target.workspaceID,
            rootID: catalog.target.rootID,
            paneID: catalog.target.paneID,
            sources: [],
            actor: 'user',
          }
        : undefined,
    {
      query: queryFiles,
      extract: vi.fn(async (file: string) => {
        if (file.endsWith('.xlsx')) return extractDocument(file);
        const text = await readFile(file, 'utf8');
        return {
          path: file,
          metadata: {},
          text,
          evidence: [
            { source: 'text', text, anchor: { kind: 'text', line: 1, start: 0, end: text.length } },
          ],
          truncated: false,
        };
      }),
      inspect: vi.fn(),
      drawingGeometry: readDrawingGeometry,
    } as unknown as FileServices,
    {
      cancel: vi.fn(),
      all: vi.fn(async () => structuredClone(actionTasks)),
      get: vi.fn(async (id: string) => {
        const task = actionTasks.find((item) => item.id === id);
        if (!task) throw new Error('Task not found.');
        return structuredClone(task);
      }),
      start: startAction,
    } as unknown as ActionPlanner,
    {
      catalog: () => catalog,
      config: settings,
      requests,
      sessions,
      workspaceState: async () => snapshot,
      relationships: async (file: string) => ({
        file,
        relations: relationshipRows,
        files: relationshipRows
          .flatMap((row) => [row.from, row.to])
          .map((node) => ({
            path: node.path,
            status: 'unverified' as const,
            reason: 'Private reason text',
          })),
        coverage: 'complete' as const,
        reasons: [],
      }),
      access: async () => {
        if (denied) throw new Error('Native folder permission was revoked.');
      },
    },
  );
  await allowAgentAccess({
    enabled: true,
    add: [files],
    capabilities: ['metadata', 'content', 'navigation', 'propose', 'terminal-read'],
  });
  token = await broker.credential();
});
afterEach(async () => {
  await broker.close();
  settings.close();
  await trashTemporary(root);
});

it('returns content search evidence only for granted paths and rechecks a changed content capability', async () => {
  const allowedFile = await entry(path.join(files, 'Résumé.txt'));
  const privateFile = path.join(secret, 'Private.txt');
  await writeFile(privateFile, 'Unshared contents.');
  const outsideFile = await entry(privateFile);
  const reader = await broker.clients.create({
    name: 'Generated search reader',
    roots: [files],
    capabilities: ['metadata', 'content'],
    budgets: { maxReadBytes: 1048576, maxTasks: 2 },
  });
  token = reader.token;
  const evidence = (file: typeof allowedFile) => ({
    path: file.path,
    version: { identity: file.identity, modified: file.modified, size: file.size },
    anchor: { kind: 'text' as const, line: 1, start: 0, end: 4 },
    quote: 'Generated content match.',
    coverage: 'complete' as const,
  });
  const result = {
    entries: [allowedFile, outsideFile],
    evidence: [evidence(allowedFile), evidence(outsideFile)],
    more: false,
    indexed: true,
    status: { running: false, count: 2, roots: [] },
  };
  queryFiles.mockResolvedValue(result);
  const names = await call<{ evidence?: unknown }>('search_files', {
    query: 'content',
    root: files,
    content: false,
  });
  expect(names.evidence).toBeUndefined();
  const matches = await call<{ entries: { path: string }[]; evidence: { path: string }[] }>(
    'search_files',
    { query: 'content', root: files, content: true },
  );
  expect(matches.entries.map((file) => file.path)).toEqual([allowedFile.path]);
  expect(matches.evidence.map((file) => file.path)).toEqual([allowedFile.path]);
  queryFiles.mockImplementation(async () => {
    const { name, roots, budgets } = reader.client;
    await broker.clients.update(reader.client.id, reader.client.revision, {
      name,
      roots,
      budgets,
      capabilities: ['metadata'],
    });
    return result;
  });
  await expect(
    call('search_files', { query: 'content', root: files, content: true }),
  ).rejects.toThrow('no content');
});

it('stores only explicitly reported own sessions with granted references and no navigation or execution', async () => {
  const report = {
    sessionID: 'local-session',
    directory: files,
    title: 'Generated report',
    sequence: 1,
    status: 'waiting',
    entries: [
      {
        id: 'first',
        role: 'assistant',
        text: 'Review this file.',
        links: [{ kind: 'file', path: path.join(files, 'Résumé.txt') }],
      },
    ],
  };
  const reported = await call<{ id: string; status: string }>('report_session', report);
  expect(reported.status).toBe('waiting');
  const stored = await sessions.request({ kind: 'read', id: reported.id });
  expect(stored).toMatchObject({
    kind: 'session',
    session: {
      sequence: 1,
      status: 'waiting',
      entries: [expect.objectContaining({ text: 'Review this file.' })],
    },
  });
  expect(navigate).not.toHaveBeenCalled();
  await expect(
    call('report_session', {
      ...report,
      sequence: 2,
      entries: [
        {
          id: 'secret',
          role: 'tool',
          text: 'Forbidden reference',
          links: [{ kind: 'file', path: secret }],
        },
      ],
    }),
  ).rejects.toThrow('outside');
  expect(await sessions.request({ kind: 'read', id: reported.id })).toMatchObject({
    session: { sequence: 1 },
  });
  denied = true;
  await expect(call('report_session', { ...report, sequence: 2 })).rejects.toThrow('revoked');
});

describe('reviewed MCP workspace navigation', () => {
  it('redacts relationship endpoints outside client roots and private user notes; reference contents need their own capability', async () => {
    const source = path.join(files, 'Résumé.txt'),
      target = path.join(files, 'Related.txt'),
      privateTarget = path.join(secret, 'Private.txt');
    await writeFile(target, 'Related');
    await writeFile(privateTarget, 'Private');
    const relation = (
      id: string,
      to: string,
      basis: FileRelation['basis'] = 'observed',
    ): FileRelation => ({
      id,
      from: { path: source },
      to: { path: to },
      kind: 'copy',
      basis,
      receipt: { service: 'operation', id },
      note: 'Private user note',
    });
    relationshipRows = [
      relation('normal', target),
      relation('outside', privateTarget),
      relation('user-note', target, 'reported'),
    ];
    const client = await broker.clients.create({
      name: 'Provenance reader',
      roots: [files],
      capabilities: ['metadata'],
      budgets: { maxReadBytes: 1048576, maxTasks: 2 },
    });
    token = client.token;
    const result = await call<{ relations: FileRelation[]; coverage: string }>(
      'get_relationships',
      { path: source },
    );
    expect(result.relations.map((row) => row.id)).toEqual(['normal']);
    expect(result.coverage).toBe('partial');
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain('Private');
    await expect(call('get_relationships', { path: source, content: true })).rejects.toThrow(
      'no content',
    );
  });
  it('counts persisted client tasks and serializes admission when two requests race for the last slot', async () => {
    const client = await broker.clients.create({
      name: 'Planner',
      roots: [files],
      capabilities: ['propose'],
      budgets: { maxReadBytes: 1048576, maxTasks: 2 },
    });
    token = client.token;
    actionTasks.push({
      version: 1,
      id: crypto.randomUUID(),
      revision: 1,
      title: 'Cold task',
      recipeID: 'batch-rename',
      context: {
        workspaceID: 'origin',
        rootID: 'folder',
        paneID: 'folder',
        sources: [files],
        actor: 'agent',
        clientID: client.client.id,
      },
      status: 'review',
      rows: [],
      undoable: false,
    });
    const results = await Promise.allSettled([
      call('run_action', { recipeID: 'batch-rename', sources: [path.join(files, 'Résumé.txt')] }),
      call('run_action', { recipeID: 'batch-rename', sources: [path.join(files, 'Résumé.txt')] }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(startAction).toHaveBeenCalledOnce();
    expect(actionTasks).toHaveLength(2);
    await expect(
      call('run_action', { recipeID: 'batch-rename', sources: [files] }),
    ).rejects.toThrow('Review or stop');
  });
  it('requires content capability for book naming, which reads publications at any data level', async () => {
    const books = settings.snapshot().settings.recipes.find((recipe) => recipe.id === 'book-name')!;
    await settings.patch(
      [
        {
          path: 'settings.recipes',
          value: [
            ...settings.snapshot().settings.recipes,
            { ...books, id: 'local-books', name: 'Local books', data: 'names' },
          ],
        },
      ],
      settings.snapshot().revision,
    );
    const client = await broker.clients.create({
      name: 'Planner',
      roots: [files],
      capabilities: ['propose'],
      budgets: { maxReadBytes: 1048576, maxTasks: 2 },
    });
    token = client.token;
    const source = path.join(files, 'Résumé.txt');
    await expect(
      call('run_action', { recipeID: 'local-books', sources: [source] }),
    ).rejects.toThrow('no content capability');
    expect(startAction).not.toHaveBeenCalled();
    // Its rows carry the extracted publication evidence, so reading the task is refused too.
    const id = crypto.randomUUID();
    actionTasks.push({
      version: 1,
      id,
      revision: 1,
      title: 'Local books',
      recipeID: 'local-books',
      context: {
        workspaceID: 'origin',
        rootID: 'folder',
        paneID: 'folder',
        sources: [source],
        actor: 'agent',
        clientID: client.client.id,
      },
      status: 'review',
      rows: [],
      undoable: false,
    });
    await expect(call('get_task', { id })).rejects.toThrow('no content capability');
    expect(await call('run_action', { recipeID: 'batch-rename', sources: [source] })).toMatchObject(
      { applyRequiresUserReview: true },
    );
  });
  it('requires content capability for source-versioned original passages and enforces returned-data budgets', async () => {
    const first = path.join(files, 'Résumé.txt');
    const reader = await broker.clients.create({
      name: 'Contents',
      roots: [files],
      capabilities: ['content'],
      budgets: { maxReadBytes: 1024, maxTasks: 2 },
    });
    token = reader.token;
    expect(await call('read_content', { path: first })).toMatchObject({
      path: first,
      coverage: 'complete',
      evidence: [{ text: 'Generated selection.' }],
      version: { size: 20 },
    });
    await expect(call('read_content', { path: secret })).rejects.toThrow('outside');
    const large = path.join(files, 'Large.txt');
    await writeFile(large, 'a'.repeat(2048));
    await expect(call('read_content', { path: large })).rejects.toThrow('read budget');
    const { name, roots, budgets } = reader.client;
    await broker.clientRequest({
      kind: 'update',
      id: reader.client.id,
      revision: 1,
      client: { name, roots, budgets, capabilities: ['metadata'] },
    });
    await expect(call('read_content', { path: first })).rejects.toThrow('no content');
  });
  it('returns a result at the read budget and refuses one byte more with its size and what to ask for (2026-10-30)', async () => {
    // A 64 MiB budget let a result through that the relay then dropped with the connection.
    const file = path.join(files, 'Budget.txt');
    await writeFile(file, 'Generated passage. '.repeat(200));
    const reader = await broker.clients.create({
      name: 'Budget',
      roots: [files],
      capabilities: ['content'],
      budgets: { maxReadBytes: 1048576, maxTasks: 2 },
    });
    token = reader.token;
    const value = await call('read_content', { path: file });
    const bytes = Buffer.byteLength(JSON.stringify(value));
    let revision = reader.client.revision;
    const budget = async (maxReadBytes: number) => {
      const { name, roots, capabilities } = reader.client;
      await broker.clientRequest({
        kind: 'update',
        id: reader.client.id,
        revision: revision++,
        client: { name, roots, capabilities, budgets: { maxReadBytes, maxTasks: 2 } },
      });
    };
    await budget(bytes);
    expect(await call('read_content', { path: file })).toEqual(value);
    await budget(bytes - 1);
    await expect(call('read_content', { path: file })).rejects.toThrow(
      `The read_content result is ${bytes.toLocaleString('en-US')} bytes, over this client’s ` +
        `read budget of ${(bytes - 1).toLocaleString('en-US')} bytes. Find the passages you need ` +
        'with search_files and content: true. Or ask the person to raise Maximum returned ' +
        'content in Settings → Agents to 1 MiB.',
    );
  });
  it('reads named worksheet windows at original sparse coordinates and honours content grants', async () => {
    const file = path.join(files, 'Measurements.xlsx');
    await writeFile(file, officeFixture('workbook'));
    const reader = await broker.clients.create({
      name: 'Sheets',
      roots: [files],
      capabilities: ['content'],
      budgets: { maxReadBytes: 1048576, maxTasks: 2 },
    });
    token = reader.token;
    const result = await call<{
      sheet: string;
      rows: {
        row: number;
        cells: {
          value: string;
          formula?: string;
          anchor: { row: number; column: number; sheet: string };
        }[];
      }[];
      more: boolean;
      coverage: string;
    }>('query_table', { path: file, offset: 1, limit: 1 });
    expect(result.sheet).toBe('Measurements');
    expect(result.rows[0].row).toBe(61);
    expect(result.rows[0].cells[1]).toMatchObject({
      value: '20',
      formula: 'SUM(B1,7.5)',
      anchor: { sheet: 'Measurements', row: 61, column: 2 },
    });
    expect(result.more).toBe(true);
    expect(result.coverage).toBe('partial');
    expect(await call('query_table', { path: file, sheet: 'Hidden' })).toMatchObject({
      sheet: 'Hidden',
      rows: [{ row: 4 }],
    });
    await expect(call('query_table', { path: file, sheet: 'Missing' })).rejects.toThrow(
      'worksheet',
    );
    const metadata = await broker.clients.create({
      name: 'Names',
      roots: [files],
      capabilities: ['metadata'],
      budgets: reader.client.budgets,
    });
    token = metadata.token;
    await expect(call('query_table', { path: file })).rejects.toThrow('no content');
  });
  it('requires a named content grant and canonical folder scope for bounded drawing geometry', async () => {
    const file = path.join(files, 'Panel.dxf');
    await writeFile(file, panelDrawing);
    const reader = await broker.clients.create({
      name: 'CAD reader',
      roots: [files],
      capabilities: ['content'],
      budgets: { maxReadBytes: 1048576, maxTasks: 2 },
    });
    token = reader.token;
    expect(
      await call('read_drawing_geometry', { path: file, points: true, limit: 1 }),
    ).toMatchObject({
      path: file,
      units: { symbol: 'mm' },
      bounds: { max: { x: 200, y: 100 } },
    });
    await writeFile(path.join(secret, 'Secret.dxf'), panelDrawing);
    await expect(
      call('read_drawing_geometry', { path: path.join(secret, 'Secret.dxf') }),
    ).rejects.toThrow('outside');
    const metadata = await broker.clients.create({
      name: 'Metadata',
      roots: [files],
      capabilities: ['metadata'],
      budgets: { maxReadBytes: 1048576, maxTasks: 2 },
    });
    token = metadata.token;
    await expect(call('read_drawing_geometry', { path: file })).rejects.toThrow('no content');
    token = reader.token;
    await broker.clientRequest({
      kind: 'update',
      id: reader.client.id,
      revision: reader.client.revision,
      client: {
        name: reader.client.name,
        roots: reader.client.roots,
        capabilities: ['content'],
        budgets: { maxReadBytes: 1024, maxTasks: 2 },
      },
    });
    await expect(call('read_drawing_geometry', { path: file, points: true })).rejects.toThrow(
      'read budget',
    );
  });
  it('asks the person before a named client opens a project file, which installs a workspace (2026-10-20)', async () => {
    // A named client's navigation runs at once; a project file's opens a whole workspace from it.
    const project = path.join(files, 'viewer.project.jsonc');
    await writeFile(project, '{}');
    const navigator = await broker.clients.create({
      name: 'Navigator',
      roots: [files],
      capabilities: ['navigation'],
      budgets: { maxReadBytes: 1048576, maxTasks: 2 },
    });
    token = navigator.token;
    const proposal = await call<{ id: string; requiresUserReview: boolean }>('propose_open_path', {
      path: project,
    });
    expect(proposal.requiresUserReview).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });
  it('asks the person before a named client opens a tour file, which opens every file it stops at', async () => {
    const tour = path.join(files, 'Job.viewer-tour.jsonc');
    await writeFile(tour, '{}');
    const navigator = await broker.clients.create({
      name: 'Navigator',
      roots: [files],
      capabilities: ['navigation'],
      budgets: { maxReadBytes: 1048576, maxTasks: 2 },
    });
    token = navigator.token;
    const proposal = await call<{ id: string; requiresUserReview: boolean }>('propose_open_path', {
      path: tour,
    });
    expect(proposal.requiresUserReview).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });
  it('navigates with a named client grant, keeps proposals owned and rejects other clients and revoked credentials', async () => {
    const navigator = await broker.clients.create({
      name: 'Navigator',
      roots: [files],
      capabilities: ['navigation'],
      budgets: { maxReadBytes: 1048576, maxTasks: 2 },
    });
    const reader = await broker.clients.create({
      name: 'Reader',
      roots: [files],
      capabilities: ['metadata'],
      budgets: { maxReadBytes: 1048576, maxTasks: 2 },
    });
    const original = token;
    token = navigator.token;
    const proposal = await call<{ id: string; requiresUserReview: boolean }>('propose_open_path', {
      path: files,
    });
    expect(proposal.requiresUserReview).toBe(false);
    expect(navigate).toHaveBeenCalledOnce();
    expect(await call('get_proposal', { id: proposal.id })).toMatchObject({
      clientID: navigator.client.id,
      status: 'completed',
    });
    token = reader.token;
    await expect(call('get_proposal', { id: proposal.id })).rejects.toThrow('another actor');
    await expect(call('propose_open_path', { path: files })).rejects.toThrow('no navigation');
    token = navigator.token;
    await expect(call('propose_open_path', { path: secret })).rejects.toThrow('outside');
    await broker.clientRequest({ kind: 'revoke', id: navigator.client.id, revision: 1 });
    await expect(call('propose_open_path', { path: files })).rejects.toThrow('invalid');
    token = original;
    const shared = await call<{ requiresUserReview: boolean }>('propose_open_path', {
      path: files,
    });
    expect(shared.requiresUserReview).toBe(true);
  });
  it('discovers live granted planes, redacts inaccessible workspaces and never exposes histories/layout', async () => {
    const workspaces =
      await call<{ id: string; roots: string[]; active: boolean; panes: unknown[] }[]>(
        'list_workspaces',
      );
    expect(workspaces.map((space) => space.id)).toEqual(['origin', 'destination', 'empty']);
    expect(workspaces[0]).toMatchObject({
      active: true,
      roots: ['folder'],
      panes: [plane('folder', files)],
    });
    expect(JSON.stringify(workspaces)).not.toContain(secret);
    expect(JSON.stringify(workspaces)).not.toMatch(/history|arrangement|global|private-plane/);
    expect(await call('list_planes')).toEqual([plane('folder', files)]);
    expect(await call('list_planes', { workspaceID: 'destination' })).toEqual([
      plane('destination-folder', files),
    ]);
    expect(await call('list_planes', { workspaceID: 'private' })).toEqual([]);
    expect(await call('list_planes', { workspaceID: 'missing' })).toEqual([]);
    catalog = undefined;
    expect(await call('list_workspaces')).toHaveLength(3);
    await expect(call('propose_open_path', { path: files })).rejects.toThrow(
      'Focus a granted folder',
    );
  });
  it('keeps authentication and strict arguments on discovery and proposals', async () => {
    await expect(broker.handle('invalid', { method: 'tools/list' })).rejects.toThrow('invalid');
    await expect(call('list_workspaces', { workspaceID: 'origin' })).rejects.toThrow();
    await expect(call('list_planes', { extra: true })).rejects.toThrow();
    await expect(
      call('propose_open_path', { path: files, placement: 'external' }),
    ).rejects.toThrow();
    await expect(call('propose_selection', { paths: [], execute: true })).rejects.toThrow();
    await expect(call('propose_workspace_switch', {})).rejects.toThrow('Provide one');
    await expect(
      call('propose_workspace_switch', { workspaceID: 'destination', name: 'Downloads' }),
    ).rejects.toThrow('Provide one');
    expect(navigate).not.toHaveBeenCalled();
  });
  it('focuses a granted active-workspace plane and rejects inaccessible, global or missing planes', async () => {
    const focus = await call<{ id: string }>('propose_focus_plane', { paneID: 'folder' });
    expect(navigate).not.toHaveBeenCalled();
    await requests.review(focus.id, true);
    expect(navigate).toHaveBeenCalledWith(
      { kind: 'focus-plane', pane: plane('folder', files) },
      expect.anything(),
    );
    await expect(call('propose_focus_plane', { paneID: 'private-plane' })).rejects.toThrow(
      'outside',
    );
    await expect(call('propose_focus_plane', { paneID: 'global' })).rejects.toThrow(
      'outside the agent folder scope',
    );
    await expect(call('propose_focus_plane', { paneID: 'destination-folder' })).rejects.toThrow(
      'active workspace',
    );
  });
  it('opens an independent path or switches from a genuinely empty workspace without granting home', async () => {
    snapshot.activeWorkspace = 'empty';
    catalog!.target = {
      workspaceID: 'empty',
      paneID: 'none',
      rootID: 'none',
      directory: secret,
      selection: [],
    };
    const opened = await call<{ id: string }>('propose_open_path', { path: files });
    await requests.review(opened.id, true);
    expect(requests.get(opened.id).status).toBe('completed');
    expect(await call('propose_workspace_switch', { workspaceID: 'destination' })).toMatchObject({
      requiresUserReview: true,
    });
    await expect(call('propose_selection', { paths: [] })).rejects.toThrow();
    await expect(call('propose_open_path', { path: files, placement: 'linked' })).rejects.toThrow(
      'Focus a folder',
    );
    snapshot.workspaces.find((space) => space.id === 'empty')!.panes.push(plane('changed', secret));
    await expect(call('propose_open_path', { path: files })).rejects.toThrow(
      'originating workspace changed',
    );
  });
  it('opens only granted paths after explicit review; rejection makes no change', async () => {
    await symlink(secret, path.join(files, 'Escape'));
    await expect(call('propose_open_path', { path: path.join(files, 'Escape') })).rejects.toThrow(
      'outside',
    );
    await expect(call('propose_open_path', { path: secret })).rejects.toThrow('outside');
    await expect(call('propose_open_path', { path: 'relative' })).rejects.toThrow();
    const first = await call<{ id: string; requiresUserReview: boolean }>('propose_open_path', {
      path: files,
    });
    expect(first.requiresUserReview).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    await requests.review(first.id, false);
    expect((await call<{ status: string }>('get_proposal', { id: first.id })).status).toBe(
      'rejected',
    );
    expect(navigate).not.toHaveBeenCalled();
    const approved = await call<{ id: string }>('propose_open_path', {
      path: files,
      placement: 'root',
    });
    await requests.review(approved.id, true);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      { kind: 'open-path', path: files, placement: 'root' },
      expect.objectContaining({ paneID: 'folder' }),
    );
    expect(requests.get(approved.id).status).toBe('completed');
    expect(await readFile(path.join(files, 'Résumé.txt'), 'utf8')).toBe('Generated selection.');
  });
  it('deduplicates a literal Unicode selection, confines it to the captured folder and supports clearing', async () => {
    const file = path.join(files, 'Résumé.txt');
    const proposal = await call<{ id: string }>('propose_selection', { paths: [file, file] });
    expect(requests.get(proposal.id).navigation).toMatchObject({
      kind: 'select-files',
      files: [{ path: file }],
    });
    expect(requests.get(proposal.id).target!.selection).toHaveLength(1);
    await requests.review(proposal.id, true);
    await mkdir(path.join(files, 'Nested'));
    await writeFile(path.join(files, 'Nested', 'Child.txt'), 'Child');
    await expect(
      call('propose_selection', { paths: [path.join(files, 'Nested', 'Child.txt')] }),
    ).rejects.toThrow('captured folder');
    const clear = await call<{ id: string }>('propose_selection', { paths: [] });
    await requests.review(clear.id, true);
    expect(navigate).toHaveBeenLastCalledWith(
      { kind: 'select-files', files: [] },
      expect.objectContaining({ selection: [] }),
    );
  });
  it('resolves an exact unique workspace name and snapshots the granted destination before review', async () => {
    const result = await call<{ id: string }>('propose_workspace_switch', { name: 'Downloads' });
    const destination = structuredClone(snapshot.workspaces[1]);
    snapshot.workspaces[1].panes[0].path = secret;
    await requests.review(result.id, true);
    expect(navigate).toHaveBeenCalledWith(
      { kind: 'switch-workspace', workspace: destination },
      expect.anything(),
    );
    await expect(call('propose_workspace_switch', { workspaceID: 'destination' })).rejects.toThrow(
      'outside',
    );
    await expect(call('propose_workspace_switch', { workspaceID: 'origin' })).rejects.toThrow(
      'outside',
    );
    snapshot.workspaces[1].panes[0].path = files;
    snapshot.workspaces.push({ ...destination, id: 'same-name' });
    await expect(call('propose_workspace_switch', { name: 'Downloads' })).rejects.toThrow('unique');
    await expect(call('propose_workspace_switch', { name: 'downloads' })).rejects.toThrow('unique');
    expect(await call('propose_workspace_switch', { workspaceID: 'same-name' })).toMatchObject({
      requiresUserReview: true,
    });
    snapshot.workspaces[0].panes = [
      { id: 'global', type: 'search', path: files, allLocations: true },
    ];
    await expect(call('propose_workspace_switch', { workspaceID: 'origin' })).rejects.toThrow(
      'outside the agent folder scope',
    );
  });
  it('answers alike for missing and existing paths outside the agent folders', async () => {
    const message = 'outside the agent’s authorized folders';
    await expect(broker.authorize(secret)).rejects.toThrow(message);
    await expect(broker.authorize(path.join(root, 'no such file'))).rejects.toThrow(message);
  });
  it.each(['native', 'roots', 'disabled'])(
    'rechecks %s permission after review',
    async (change) => {
      const proposal = await call<{ id: string }>('propose_open_path', { path: files });
      if (change === 'native') denied = true;
      else
        await settings.patch(
          [
            {
              path: 'settings.agents',
              value: {
                enabled: change !== 'disabled',
                roots: change === 'roots' ? [] : [files],
                allowLayout: false,
              },
            },
          ],
          settings.snapshot().revision,
        );
      await expect(requests.review(proposal.id, true)).rejects.toThrow(/revoked|outside|disabled/);
      expect(requests.get(proposal.id).status).toBe('failed');
    },
  );
  it('rejects a replaced file after review and invalidates proposal ownership on token rotation', async () => {
    const file = path.join(files, 'Résumé.txt');
    const selected = await call<{ id: string }>('propose_selection', { paths: [file] });
    await rename(file, file + '.old');
    await writeFile(file, 'Replacement');
    await expect(requests.review(selected.id, true)).rejects.toThrow('Selection changed');
    expect(requests.get(selected.id).status).toBe('failed');
    token = await broker.credential();
    await expect(call('get_proposal', { id: selected.id })).rejects.toThrow('another actor');
    expect(await realpath(file)).toBe(await broker.authorize(file));
  });
  it('takes no folder or switch from config.jsonc that the person did not approve (2026-10-20)', async () => {
    // A config.jsonc edit or an Import widened the shared token's folders with no prompt.
    const file = path.join(secret, 'Ledger.txt');
    await writeFile(file, 'Private.');
    await broker.authorize(path.join(files, 'Résumé.txt'));
    await settings.patch(
      [{ path: 'settings.agents.roots', value: [files, secret] }],
      settings.snapshot().revision,
    );
    await expect(broker.authorize(file)).rejects.toThrow('outside the agent’s authorized folders');
    await allowAgentAccess({ add: [secret] });
    expect(await broker.authorize(file)).toBe(await realpath(file));
    await settings.patch(
      [{ path: 'settings.agents.enabled', value: false }],
      settings.snapshot().revision,
    );
    await expect(broker.authorize(file)).rejects.toThrow('disabled');
  });
  it('lets an agent read its own proposal however many requests came after it (2026-10-20)', async () => {
    // The ownership record kept its newest half: an older proposal still under review was lost.
    const selected = await call<{ id: string }>('propose_selection', {
      paths: [path.join(files, 'Résumé.txt')],
    });
    for (let index = 0; index < 1000; index++)
      (broker as unknown as { own(id: string): void }).own(`finished-${index}`);
    expect((await call<{ id: string }>('get_proposal', { id: selected.id })).id).toBe(selected.id);
  });
  it('holds the shared connection to the capabilities the person left it (2026-10-20)', async () => {
    // The shared token held every capability, document contents included, and nothing narrowed it.
    const sources = [path.join(files, 'Résumé.txt')];
    await broker.access.approve({ capabilities: ['metadata', 'navigation', 'propose'] });
    expect((await broker.access.state()).capabilities).toEqual([
      'metadata',
      'navigation',
      'propose',
    ]);
    await expect(call('run_action', { recipeID: 'rename', sources })).rejects.toThrow('no content');
    expect(startAction).not.toHaveBeenCalled();
  });
  it('revokes the shared connection’s terminal grants with its token (2026-10-21)', async () => {
    // The grants belonged to the connection, so the token given after the old one leaked kept them.
    await requests.grant('*', files, 'terminal-read', true);
    const named = await broker.clients.create({
      name: 'Reader',
      roots: [files],
      capabilities: ['metadata', 'terminal-read'],
      budgets: { maxReadBytes: 1048576, maxTasks: 2 },
    });
    await requests.grant('*', files, 'terminal-read', true, named.client.id);
    await broker.credential();
    expect((await requests.listGrants()).map((grant) => grant.clientID)).toEqual([named.client.id]);
    // and a revoked client's grants, which nothing could use again, go with it
    await broker.clientRequest({ kind: 'revoke', id: named.client.id, revision: 1 });
    expect(await requests.listGrants()).toEqual([]);
  });
});
