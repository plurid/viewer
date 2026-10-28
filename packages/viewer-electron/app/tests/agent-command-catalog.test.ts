import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CapturedTarget } from '../src/domain/automation/actions';
import type {
  AgentProposal,
  AgentWorkspaceSnapshot,
  CommandDescriptor,
} from '../src/domain/agents/requests';
import { AgentBroker } from '../src/desktop/agents/agent-broker';
import { AgentRequests } from '../src/desktop/agents/agent-requests';
import type { AgentAccessChange } from '../src/desktop/agents/agent-access';
import { SettingsService } from '../src/desktop/preferences/settings';
import { entry } from '../src/desktop/files/filesystem';
import type { FileServices } from '../src/desktop/files/file-services';
import type { ActionPlanner } from '../src/desktop/actions/planner';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let directory: string;
let allowed: string;
let unshared: string;
let token: string;
let settings: SettingsService;
let broker: AgentBroker;
let requests: AgentRequests;
let target: CapturedTarget;
let workspaces: AgentWorkspaceSnapshot;
const execute = vi.fn(async () => {});
const access = vi.fn(async () => {});
const commands: CommandDescriptor[] = [
  { id: 'profile.focus', label: 'Profile: Focus', group: 'View', aliases: ['focus'] },
  { id: 'setting.ui.space.grid', label: 'Show grid', group: 'Settings', aliases: [] },
  { id: 'new-workspace', label: 'New workspace…', group: 'Workspaces', aliases: [] },
  { id: 'install-viewer-cli', label: 'Install Viewer CLI', group: 'Navigation', aliases: [] },
];

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const reply = (await broker.handle(token, {
    method: 'tools/call',
    params: { name, arguments: args },
  })) as { content: { text: string }[] };
  return JSON.parse(reply.content[0]!.text) as T;
}

beforeEach(async () => {
  directory = await temporaryRoot('viewer-agent-command-catalog-');
  allowed = path.join(directory, 'Shared');
  unshared = path.join(directory, 'Unshared');
  await mkdir(allowed);
  await mkdir(unshared);
  await writeFile(path.join(unshared, 'private.txt'), 'Private generated fixture.');
  const data = path.join(directory, 'profile');
  settings = new SettingsService(
    data,
    allowed,
    () => false,
    () => {},
  );
  await settings.load();
  await settings.patch(
    [{ path: 'settings.agents', value: { enabled: true, roots: [allowed], allowLayout: false } }],
    settings.snapshot().revision,
  );
  target = {
    workspaceID: 'empty',
    rootID: 'none',
    paneID: 'none',
    directory: unshared,
    selection: [],
  };
  workspaces = {
    activeWorkspace: 'empty',
    workspaces: [{ id: 'empty', name: 'Empty', roots: [], panes: [] }],
  };
  execute.mockClear();
  access.mockClear();
  requests = new AgentRequests(
    data,
    settings,
    () => {},
    execute,
    { read: () => ({ cwd: allowed, output: '' }) },
    undefined,
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
    () => undefined,
    {} as FileServices,
    { all: async () => [], cancel: () => {} } as unknown as ActionPlanner,
    {
      catalog: () => ({ target, commands }),
      requests,
      config: settings,
      workspaceState: async () => workspaces,
      access,
    },
  );
  const authority: AgentAccessChange = {
    enabled: true,
    add: [allowed],
    capabilities: ['metadata', 'propose'],
  };
  await broker.access.approve(authority, await broker.access.captureReview(authority));
  token = await broker.credential();
});

afterEach(async () => {
  await broker.close();
  settings.close();
  await trashTemporary(directory);
});

describe('agent window command discovery', () => {
  it('discovers and proposes allowed window commands from an empty workspace without granting Home', async () => {
    const catalog = await call<{ commands: CommandDescriptor[]; reviewByDefault: boolean }>(
      'list_commands',
    );
    expect(catalog.commands.map((command) => command.id)).toEqual([
      'profile.focus',
      'setting.ui.space.grid',
      'new-workspace',
    ]);
    expect(catalog.reviewByDefault).toBe(true);
    const explanation = await call<{ target: CapturedTarget; reviewByDefault: boolean }>(
      'explain_command',
      { commandID: 'profile.focus' },
    );
    expect(explanation).toMatchObject({ target, reviewByDefault: true });
    for (const commandID of ['profile.focus', 'setting.ui.space.grid', 'new-workspace']) {
      const proposal = await call<{ id: string; requiresUserReview: boolean }>('propose_command', {
        commandID,
      });
      expect(proposal.requiresUserReview).toBe(true);
      expect(requests.get(proposal.id).status).toBe('review');
      await expect(requests.review(proposal.id, true)).rejects.toThrow('Native confirmation');
      expect(requests.get(proposal.id).status).toBe('review');
      await requests.review(proposal.id, false);
      expect(requests.get(proposal.id).status).toBe('rejected');
    }
    expect(execute).not.toHaveBeenCalled();
    expect(access).not.toHaveBeenCalled();
    const pending = await call<{ id: string }>('propose_command', { commandID: 'profile.focus' });
    expect(await call('cancel_proposal', { id: pending.id })).toMatchObject({
      id: pending.id,
      status: 'cancelled',
    });
    expect(execute).not.toHaveBeenCalled();
    await expect(call('propose_command', { commandID: 'install-viewer-cli' })).rejects.toThrow(
      'Agents cannot propose',
    );
  });

  it('requires canonical folder and selection authority for every file context', async () => {
    target = {
      ...target,
      rootID: 'folder',
      paneID: 'folder',
      panePath: unshared,
    };
    await expect(call('list_commands')).rejects.toThrow('authorized folders');
    target.directory = allowed;
    target.panePath = allowed;
    const catalog = await call<{ commands: CommandDescriptor[] }>('list_commands');
    expect(catalog.commands.some((command) => command.id === 'profile.focus')).toBe(true);
    const escaped = path.join(allowed, 'Escape');
    await symlink(unshared, escaped);
    target.selection = [await entry(path.join(escaped, 'private.txt'))];
    for (const tool of ['list_commands', 'explain_command', 'propose_command']) {
      await expect(call(tool, { commandID: 'profile.focus' })).rejects.toThrow(
        'authorized folders',
      );
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects partial markers, hidden selection and pane paths instead of treating them as an empty origin', async () => {
    const original = structuredClone(target);
    const file = await entry(path.join(unshared, 'private.txt'));
    for (const patch of [
      { rootID: 'folder' },
      { paneID: 'folder' },
      { selection: [file] },
      { panePath: unshared },
    ]) {
      target = { ...original, directory: allowed, ...patch };
      await expect(call('list_commands')).rejects.toThrow();
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('revalidates a proposed empty origin after a workspace switch or a new plane', async () => {
    const proposal: AgentProposal = {
      id: crypto.randomUUID(),
      kind: 'command',
      commandID: 'profile.focus',
      title: 'Profile: Focus',
      detail: 'Generated fixture.',
      target,
      status: 'review',
    };
    await expect(broker.authorizeProposal(proposal)).resolves.toBeUndefined();
    workspaces.activeWorkspace = 'another';
    await expect(broker.authorizeProposal(proposal)).rejects.toThrow('workspace changed');
    workspaces.activeWorkspace = 'empty';
    workspaces.workspaces[0]!.panes.push({ id: 'new', type: 'folder', path: allowed });
    await expect(broker.authorizeProposal(proposal)).rejects.toThrow('workspace changed');
    await expect(call('list_commands')).rejects.toThrow('workspace changed');
    expect(execute).not.toHaveBeenCalled();
  });
});
