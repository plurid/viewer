import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentNavigation, AgentWorkspaceSnapshot } from '../src/domain/agent-requests';
import type { CapturedTarget } from '../src/domain/automation';
import { AgentBroker } from '../src/desktop/agent-broker';
import { AgentRequests } from '../src/desktop/agent-requests';
import { SettingsService } from '../src/desktop/settings';
import type { FileServices } from '../src/desktop/file-services';
import type { ActionPlanner } from '../src/desktop/actions/planner';

let root: string, files: string, secret: string, token: string;
let settings: SettingsService, broker: AgentBroker, requests: AgentRequests;
let catalog: { target: CapturedTarget; commands: [] } | undefined;
let snapshot: AgentWorkspaceSnapshot;
let denied: boolean;
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
  root = await mkdtemp(path.join(os.tmpdir(), 'viewer-agent-navigation-'));
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
    { read: () => ({ cwd: files, output: '' }), write: () => {} },
    navigate,
  );
  broker = new AgentBroker(
    data,
    () => settings.snapshot().settings,
    () => undefined,
    {} as FileServices,
    {} as ActionPlanner,
    {
      catalog: () => catalog,
      config: settings,
      requests,
      workspaceState: async () => snapshot,
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
  await rm(root, { recursive: true, force: true });
});

describe('reviewed MCP workspace navigation', () => {
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
