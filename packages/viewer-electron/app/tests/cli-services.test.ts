import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AgentServiceTools, type AgentServiceContext } from '../src/desktop/agents/service-tools';
import { AgentRequests } from '../src/desktop/agents/agent-requests';
import { SettingsService } from '../src/desktop/preferences/settings';
import { defaultSettings } from '../src/domain/services';
import { newModelProvider } from '../src/domain/models/providers';
import { workflowDefinitionSchema, workflowRunSchema } from '../src/domain/automation/workflows';
import type { AgentCapability } from '../src/domain/agents/clients';
import type { AgentProposal } from '../src/domain/agents/requests';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const definition = workflowDefinitionSchema.parse({
  version: 1,
  id: 'inspect',
  name: 'Generated inspection',
  inputs: { source: { path: 'Report.txt' } },
  steps: [
    { id: 'inspect', kind: 'inspect', sources: [{ kind: 'input', name: 'source' }], content: true },
  ],
});
function fixture() {
  let capabilities = new Set<AgentCapability>(['metadata', 'content', 'propose']);
  const signal = new AbortController();
  const run = workflowRunSchema.parse({
    version: 1,
    id: crypto.randomUUID(),
    file: '/shared/viewer.workflow.jsonc',
    revision: 'one',
    created: Date.now(),
    updated: Date.now(),
    status: 'running',
    definition,
    bindings: {},
    context: {
      actor: 'agent',
      clientID: 'client-one',
      workspaceID: 'workspace',
      rootID: 'folder',
      paneID: 'folder',
      sources: [],
    },
    steps: [{ id: 'inspect', kind: 'inspect', status: 'pending', sources: [], outputs: [] }],
  });
  const workflows = {
    request: vi.fn<ConstructorParameters<typeof AgentServiceTools>[0]['workflows']['request']>(
      async (request) => {
        if (request.kind === 'read')
          return { file: run.file, root: '/shared', revision: run.revision, definition };
        if (request.kind === 'list') return [structuredClone(run)];
        return structuredClone(run);
      },
    ),
  };
  const git = {
    root: vi.fn(async () => '/shared'),
    status: vi.fn(async () => ({
      kind: 'ready' as const,
      snapshot: { root: '/shared', updated: Date.now(), branch: 'main', changes: [] },
    })),
    diff: vi.fn(async () => ({
      root: '/shared',
      base: 'HEAD',
      commit: 'a'.repeat(40),
      patch: '',
      includesUntracked: false,
      observed: Date.now(),
    })),
  };
  const speech = {
    status: vi.fn(async () => ({
      selected: undefined,
      runtime: {
        name: 'whisper.cpp' as const,
        recognitionAvailable: false,
        reason: 'No recognition runtime.',
      },
      models: [],
      records: [],
    })),
    describe: vi.fn(async () => 'Download the pinned generated weights.'),
  };
  const proposals = {
    speech: vi.fn(() => ({ id: 'speech-proposal', requiresUserReview: true as const })),
  };
  const settings = defaultSettings('/example');
  settings.providers = [newModelProvider('openai', 'generated-provider')];
  const generate = vi.fn<ConstructorParameters<typeof AgentServiceTools>[0]['generate']>(
    async () => ({ line: 'frame-all', explanation: 'Frame the planes.' }),
  );
  const context: AgentServiceContext = {
    clientID: 'client-one',
    signal: signal.signal,
    authorize: vi.fn(async (file) => {
      if (file !== '/shared' && !file.startsWith('/shared/'))
        throw new Error('Outside granted folders.');
      return file;
    }),
    require: vi.fn(async (capability) => {
      if (!capabilities.has(capability)) throw new Error('Missing ' + capability + ' capability.');
    }),
    catalog: () => ({
      target: {
        workspaceID: 'workspace',
        rootID: 'folder',
        paneID: 'folder',
        directory: '/shared',
        selection: [],
      },
      commands: [
        { id: 'frame-all', label: 'Frame all', group: 'View', aliases: [] },
        { id: 'open-terminal', label: 'Open terminal', group: 'Terminal', aliases: [] },
      ],
    }),
    workspaceState: async () => ({
      activeWorkspace: 'workspace',
      workspaces: [
        {
          id: 'workspace',
          name: 'Generated workspace',
          roots: [],
          panes: [],
          tasks: [
            { id: 'visible', name: 'Granted task', path: '/shared/checkout' },
            { id: 'private', name: 'Private task', path: '/private/checkout' },
          ],
        },
      ],
    }),
    own: vi.fn(),
  };
  const services = new AgentServiceTools({
    git,
    workflows,
    speech,
    proposals,
    settings: () => settings,
    generate,
  });
  return {
    services,
    context,
    git,
    workflows,
    speech,
    proposals,
    generate,
    signal,
    run,
    restrict: (...allowed: AgentCapability[]) => {
      capabilities = new Set(allowed);
    },
    call: (name: string, args: Record<string, unknown> = {}) => services.call(name, args, context),
  };
}

describe('scoped CLI service adapters', () => {
  it('authorizes the whole repository before status scans and requires content for patches', async () => {
    const f = fixture();
    f.git.root.mockResolvedValue('/private/checkout');
    await expect(f.call('git_status', { path: '/shared/subfolder' })).rejects.toThrow('Outside');
    expect(f.git.status).not.toHaveBeenCalled();
    f.git.root.mockResolvedValue('/shared');
    f.restrict('metadata');
    await expect(f.call('git_status', { path: '/shared' })).resolves.toMatchObject({
      kind: 'ready',
    });
    await expect(f.call('git_diff', { path: '/shared' })).rejects.toThrow('content');
    expect(f.git.diff).not.toHaveBeenCalled();
  });
  it('filters task names by checkout scope', async () => {
    const f = fixture();
    expect(await f.call('list_task_areas')).toEqual([
      { id: 'visible', name: 'Granted task', path: '/shared/checkout', workspaceID: 'workspace' },
    ]);
  });
  it('keeps model status offline and creates only reviewed typed setup proposals', async () => {
    const f = fixture();
    expect(await f.call('speech_status')).toMatchObject({
      runtime: { recognitionAvailable: false },
    });
    expect(f.proposals.speech).not.toHaveBeenCalled();
    await expect(
      f.call('propose_speech_import', { model: 'whisper-tiny', source: '/private/model.bin' }),
    ).rejects.toThrow('Outside');
    expect(f.proposals.speech).not.toHaveBeenCalled();
    await f.call('propose_speech_install', { model: 'whisper-tiny' });
    expect(f.proposals.speech).toHaveBeenCalledWith(
      { kind: 'install', model: 'whisper-tiny' },
      expect.any(String),
    );
    expect(f.context.own).toHaveBeenCalledWith('speech-proposal');
    f.speech.describe.mockImplementation(async () => {
      f.signal.abort();
      return 'Reviewed detail';
    });
    await expect(f.call('propose_speech_use', { model: 'whisper-tiny' })).rejects.toThrow();
    expect(f.proposals.speech).toHaveBeenCalledTimes(1);
  });
  it('submits a captured workflow as its client and returns a bounded receipt', async () => {
    const f = fixture();
    expect(await f.call('run_workflow', { file: f.run.file })).toEqual({
      id: f.run.id,
      status: 'running',
    });
    expect(f.workflows.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: 'start',
        context: expect.objectContaining({ actor: 'agent', clientID: 'client-one' }),
      }),
    );
    f.context.clientID = 'another-client';
    for (const name of ['get_workflow', 'resume_workflow', 'cancel_workflow'])
      await expect(f.call(name, { id: f.run.id })).rejects.toThrow('another actor');
  });
  it('revalidates every bound input and output, but still allows an owner to cancel revoked work', async () => {
    const f = fixture();
    f.run.bindings = { other: '/private' };
    await expect(f.services.authorizeWorkflow(f.run, f.context)).rejects.toThrow('Outside');
    expect(await f.call('list_workflows')).toEqual([]);
    await expect(f.call('resume_workflow', { id: f.run.id })).rejects.toThrow('Outside');
    expect(await f.call('cancel_workflow', { id: f.run.id })).toEqual({
      id: f.run.id,
      status: 'running',
    });
  });
  it('does not admit a workflow after the submitting request was cancelled during its read', async () => {
    const f = fixture();
    f.workflows.request.mockImplementation(async () => {
      f.signal.abort();
      return { file: f.run.file, root: '/shared', revision: f.run.revision, definition };
    });
    await expect(f.call('run_workflow', { file: f.run.file })).rejects.toThrow();
    expect(f.workflows.request).toHaveBeenCalledTimes(1);
  });
  it('uses agent provider consent and only permitted commands when asking in words', async () => {
    const f = fixture();
    expect(await f.call('ask_in_words', { prompt: 'Frame the planes' })).toEqual({
      line: 'frame-all',
      explanation: 'Frame the planes.',
    });
    const args = f.generate.mock.calls[0]!;
    expect(args.slice(-2)).toEqual(['names', 'agent']);
    expect(args[1]).toContain('frame-all');
    expect(args[1]).not.toContain('open-terminal:');
    expect(args[2]).toMatchObject({ workspaces: [] });
  });
});

it('requires native confirmation for speech setup and rechecks authority afterward', async () => {
  const root = await temporaryRoot('viewer-speech-review-');
  const settings = new SettingsService(
    path.join(root, 'Profile'),
    root,
    () => false,
    () => {},
  );
  await settings.load();
  let denied = false;
  const setup = vi.fn(async () => {}),
    confirm = vi.fn(async (_proposal: AgentProposal) => true);
  const requests = new AgentRequests(
    root,
    settings,
    () => {},
    async () => {},
    { read: () => ({ cwd: root, output: '' }) },
    undefined,
    {
      actor: () => 'client-one',
      check: async () => {
        if (denied) throw new Error('Grant revoked.');
      },
      run: async (_id, work) => work(),
      cancelExecution: () => {},
    },
    confirm,
    undefined,
    setup,
  );
  try {
    const unavailable = new AgentRequests(
      root,
      settings,
      () => {},
      async () => {},
      { read: () => ({ cwd: root, output: '' }) },
    );
    const gated = unavailable.speech(
      { kind: 'install', model: 'whisper-tiny' },
      'Generated review',
    );
    await expect(unavailable.review(gated.id, true)).rejects.toThrow('Native confirmation');
    const rejected = requests.speech(
      { kind: 'install', model: 'whisper-tiny' },
      'Generated review',
    );
    expect(requests.get(rejected.id).status).toBe('review');
    await requests.review(rejected.id, false);
    expect(setup).not.toHaveBeenCalled();
    const cancelled = requests.speech(
      { kind: 'install', model: 'whisper-tiny' },
      'Generated review',
    );
    expect(() => requests.cancel(cancelled.id, 'another-client')).toThrow('another actor');
    requests.cancel(cancelled.id, 'client-one');
    expect(requests.get(cancelled.id).status).toBe('cancelled');
    const revoked = requests.speech({ kind: 'install', model: 'whisper-tiny' }, 'Generated review');
    confirm.mockImplementation(async () => {
      denied = true;
      return true;
    });
    await expect(requests.review(revoked.id, true)).rejects.toThrow('revoked');
    expect(requests.get(revoked.id).status).toBe('failed');
    expect(setup).not.toHaveBeenCalled();
  } finally {
    settings.close();
    await trashTemporary(root);
  }
});
