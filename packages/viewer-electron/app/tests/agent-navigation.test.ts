import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, realpath, rename, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentNavigation, AgentWorkspaceSnapshot } from '../src/domain/agent-requests';
import type { CapturedTarget } from '../src/domain/automation';
import { AgentBroker } from '../src/desktop/agent-broker';
import { AgentRequests } from '../src/desktop/agent-requests';
import { SettingsService } from '../src/desktop/settings';
import type { FileServices } from '../src/desktop/file-services';
import type { ActionPlanner } from '../src/desktop/actions/planner';
import type { ActionPlan, ActionRequest } from '../src/domain/services';
import type { FileRelation } from '../src/domain/relationships';
import { readDrawingGeometry } from '../src/desktop/drawing-geometry';
import { panelDrawing } from './dxf-fixtures';
import { officeFixture } from './office-fixtures';
import { extractDocument } from '../src/desktop/formats';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string, files: string, secret: string, token: string;
let settings: SettingsService, broker: AgentBroker, requests: AgentRequests;
let catalog: { target: CapturedTarget; commands: [] } | undefined;
let snapshot: AgentWorkspaceSnapshot;
let denied: boolean;
let actionTasks: ActionPlan[];
let relationshipRows: FileRelation[];
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
beforeEach(async () => {
  actionTasks = [];
  relationshipRows = [];
  startAction.mockClear();
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
      start: startAction,
    } as unknown as ActionPlanner,
    {
      catalog: () => catalog,
      config: settings,
      requests,
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
  token = await broker.credential();
});
afterEach(async () => {
  await broker.close();
  settings.close();
  await trashTemporary(root);
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
});
