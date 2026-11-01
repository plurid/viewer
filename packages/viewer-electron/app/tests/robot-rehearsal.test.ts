import { mkdir, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { temporaryRoot } from '../tools/temporary';
import * as rehearsal from '../tools/robotics/rehearsal';
import { currentRobotSession, runRobotSession } from '../tools/robotics/rehearsal-session';
import { recordRobotRequests } from '../tools/robotics/rehearsal-transport';
import { Canvases } from '../src/desktop/canvases/service';
import { ChatDocumentStore } from '../src/desktop/chat/documents';
import { parseRobotURDF } from '../src/domain/robotics/urdf';
import type { ChatStep } from '../src/domain/models/chat';
import type { ModelProvider } from '../src/domain/services';
import type { RobotSessionOptions } from '../tools/robotics/rehearsal-session';

let root: string;
beforeEach(async () => {
  root = await realpath(await temporaryRoot('viewer-robot-rehearsal-test-'));
  await mkdir(path.join(root, 'sessions'));
});
afterEach(() => vi.restoreAllMocks());

describe('robot rehearsal budgets and retained responses', () => {
  it('counts failures across restarts, refuses expansion, and stops at the approved number', async () => {
    const ledger = new rehearsal.RobotRehearsalLedger(root);
    await ledger.authorize({ sessions: 2, requestsPerSession: 2 });
    const first = await ledger.begin('create', {});
    await first.reserveRequest({ command: 'first' });
    await first.reserveRequest({ command: 'second' });
    await expect(first.reserveRequest({ command: 'third' })).rejects.toThrow('request budget');
    await first.finish({ status: 'failed' });
    const restarted = new rehearsal.RobotRehearsalLedger(root);
    await restarted.authorize({ sessions: 2, requestsPerSession: 2 });
    await expect(restarted.authorize({ sessions: 3, requestsPerSession: 2 })).rejects.toThrow(
      'cannot be extended',
    );
    await (await restarted.begin('create', {})).finish({ status: 'stopped' });
    await expect(restarted.begin('create', {})).rejects.toThrow('session budget');
  });

  it('preserves an interrupted attempt and refuses another automatic attempt', async () => {
    const ledger = new rehearsal.RobotRehearsalLedger(root);
    await ledger.authorize({ sessions: 2, requestsPerSession: 8 });
    const first = await ledger.begin('create', {});
    await first.reserveRequest({});
    await expect(new rehearsal.RobotRehearsalLedger(root).begin('create', {})).rejects.toThrow();
    expect(await readdir(first.folder)).toEqual(['request-01.json', 'started.json']);
  });

  it('allows only one concurrent reservation of the next session', async () => {
    const a = new rehearsal.RobotRehearsalLedger(root);
    const b = new rehearsal.RobotRehearsalLedger(root);
    await a.authorize({ sessions: 2, requestsPerSession: 8 });
    const results = await Promise.allSettled([a.begin('create', {}), b.begin('create', {})]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await a.sessions()).toHaveLength(1);
  });

  it('retains raw rejected envelopes and usage without request headers or echoed credentials', async () => {
    const ledger = new rehearsal.RobotRehearsalLedger(root);
    await ledger.authorize({ sessions: 1, requestsPerSession: 1 });
    const session = await ledger.begin('create', {});
    const network = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ error: 'example-secret', usage: { total_tokens: 42 } }, { status: 429 }),
      );
    const request = recordRobotRequests(session, network, (text) =>
      text.replaceAll('example-secret', '[redacted]'),
    );
    const response = await request('https://example.invalid', {
      method: 'POST',
      headers: { Authorization: 'Bearer example-secret' },
      body: JSON.stringify({ messages: ['test'] }),
    });
    expect(response.status).toBe(429);
    const saved = await rehearsal.readJSON(path.join(session.folder, 'request-01-response.json'));
    expect(saved).toMatchObject({
      status: 429,
      envelope: { error: '[redacted]', usage: { total_tokens: 42 } },
    });
    expect(await readFile(path.join(session.folder, 'request-01.json'), 'utf8')).not.toMatch(
      /Authorization|example-secret/,
    );
    await expect(request('https://example.invalid')).rejects.toThrow('request budget');
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('counts a canceled request and keeps its failure without retrying', async () => {
    const ledger = new rehearsal.RobotRehearsalLedger(root);
    await ledger.authorize({ sessions: 1, requestsPerSession: 1 });
    const session = await ledger.begin('create', {});
    const abort = new AbortController();
    const network = vi.fn<typeof fetch>(async () => {
      abort.abort();
      throw new Error('Canceled by user');
    });
    const request = recordRobotRequests(session, network, (text) => text);
    await expect(request('https://example.invalid', { signal: abort.signal })).rejects.toThrow(
      'Canceled',
    );
    expect(
      await rehearsal.readJSON(path.join(session.folder, 'request-01-error.json')),
    ).toMatchObject({ error: 'Error: Canceled by user' });
    await expect(request('https://example.invalid')).rejects.toThrow('request budget');
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('records malformed provider JSON as a spent request', async () => {
    const ledger = new rehearsal.RobotRehearsalLedger(root);
    await ledger.authorize({ sessions: 1, requestsPerSession: 1 });
    const session = await ledger.begin('create', {});
    const request = recordRobotRequests(
      session,
      async () => new Response('{broken'),
      (text) => text,
    );
    await expect(request('https://example.invalid')).rejects.toThrow();
    expect(
      await rehearsal.readJSON(path.join(session.folder, 'request-01-error.json')),
    ).toMatchObject({ status: 200 });
    await expect(request('https://example.invalid')).rejects.toThrow('request budget');
  });
});

describe('public corpus preparation', () => {
  it('rejects a changed pinned input before creating any budget or provider session', async () => {
    const corpus = path.join(root, 'Corpus');
    const run = path.join(root, 'Run');
    await mkdir(path.join(corpus, 'Simulation/SO101'), { recursive: true });
    await mkdir(run);
    await writeFile(path.join(corpus, 'Simulation/SO101/so101_new_calib.urdf'), 'Changed input');
    await expect(rehearsal.prepareRobotRehearsal(corpus, run)).rejects.toThrow(
      'Pinned corpus mismatch',
    );
    expect(await readdir(run)).toEqual(['SO-101']);
  });

  it('refuses links and oversized files when reading evidence', async () => {
    const file = path.join(root, 'evidence.json');
    await writeFile(file, '1234567890');
    await symlink(file, path.join(root, 'linked.json'));
    await expect(rehearsal.readEvidence(file, 5)).rejects.toThrow('bounded regular');
    await expect(rehearsal.readEvidence(path.join(root, 'linked.json'))).rejects.toThrow();
    expect((await rehearsal.readEvidence(file, 10)).toString()).toBe('1234567890');
  });
});

const provider: ModelProvider = {
  id: 'fixture',
  name: 'Scripted fixture',
  kind: 'meta',
  model: 'offline-fixture',
  endpoint: 'https://example.invalid',
  allowContent: true,
};
const step = (kind: ChatStep['kind'], extra: Partial<ChatStep> = {}): ChatStep => ({
  kind,
  text: '',
  path: null,
  query: null,
  commandID: null,
  patches: [],
  renames: [],
  files: [],
  ...extra,
});
const scripted =
  (steps: ChatStep[]): RobotSessionOptions['generate'] =>
  (session) =>
  async () => {
    await session.reserveRequest({ execution: 'scripted-test' });
    const next = steps.shift();
    if (!next) throw new Error('The scripted fixture has no more steps.');
    return next;
  };

async function localProject() {
  const project = path.join(root, 'Model');
  await mkdir(project);
  await mkdir(path.join(root, 'Profile'));
  const urdf = path.join(project, 'arm.urdf');
  const mesh = path.join(project, 'part.stl');
  await writeFile(
    urdf,
    '<robot name="arm"><link name="base"><visual><geometry><mesh filename="part.stl"/></geometry></visual></link><link name="tip"/><joint name="joint" type="revolute"><parent link="base"/><child link="tip"/><axis xyz="0 0 1"/><limit lower="-1" upper="1" effort="1" velocity="1"/></joint></robot>',
  );
  const triangle = Buffer.alloc(134);
  triangle.writeUInt32LE(1, 80);
  triangle.writeFloatLE(1, 92);
  triangle.writeFloatLE(1, 108);
  await writeFile(mesh, triangle);
  // The provider-flow test uses a small robot. The CLI preflight separately verifies the public corpus.
  vi.spyOn(rehearsal, 'verifyRobotRehearsal').mockResolvedValue({
    project,
    urdf,
    robot: parseRobotURDF(await readFile(urdf, 'utf8')),
    allowed: new Set([urdf, mesh]),
    directories: new Set([project]),
    files: [],
  });
  return { project, urdf };
}

describe('staged real Chat ownership with an offline provider fixture', () => {
  it('requires review, retains edited inputs through refinement, and forks an exact attributed quote', async () => {
    const { urdf } = await localProject();
    const options = {
      execution: 'scripted-test' as const,
      budget: { sessions: 3, requestsPerSession: 8 },
      provider,
      publicText: (text: string) => text,
    };
    const created = await runRobotSession(root, {
      ...options,
      stage: 'create',
      generate: scripted([
        step('canvas_source', { path: urdf }),
        step('canvas_robot_assets', { path: urdf }),
        step('canvas_write', {
          commandID: '2',
          text: '<p>Scripted joint tool</p>',
          patches: [{ path: 'joint', value: 0 }],
        }),
        step('reply', { text: 'The fixture has a declared joint limit.' }),
      ]),
    });
    expect(created.result.status, created.result.failure).toBe('generated');
    const saved = created.result.canvas!;
    const canvases = new Canvases(path.join(root, 'Profile'), { changed: () => {} });
    await canvases.state(1, saved.id, saved.stateRevision, saved.revision, { joint: 0.25 });
    await expect(
      runRobotSession(root, {
        ...options,
        stage: 'refine',
        reviewed: created.result.reviewToken,
        generate: scripted([]),
      }),
    ).rejects.toThrow('exact saved');
    expect(await new rehearsal.RobotRehearsalLedger(root).sessions()).toHaveLength(1);
    const current = await currentRobotSession(root, 'create');
    const refined = await runRobotSession(root, {
      ...options,
      stage: 'refine',
      reviewed: current.reviewToken,
      generate: scripted([
        step('canvas_read'),
        step('canvas_write', {
          commandID: String(saved.revision),
          text: '<p>Scripted targets</p>',
          patches: [{ path: 'joint', value: 0 }],
        }),
        step('reply', {
          text: 'The fixture has targets. Changing the base is an alternative. No collision check was performed.',
        }),
      ]),
    });
    expect(refined.result.status, refined.result.failure).toBe('generated');
    expect(refined.result.canvas!.state.joint).toBe(0.25);
    const message = refined.result.conversation!.messages.findLast(
      (message) => message.role === 'assistant',
    )!;
    const quote = 'Changing the base is an alternative.';
    const start = message.text.indexOf(quote);
    const branched = await runRobotSession(root, {
      ...options,
      stage: 'branch',
      reviewed: refined.result.reviewToken,
      quote: { messageID: message.id, start, end: start + quote.length },
      generate: scripted([
        step('canvas_read'),
        step('canvas_write', { commandID: '0', text: '<p>Scripted base alternative</p>' }),
        step('reply', { text: 'This is a scripted alternative, not a live model result.' }),
      ]),
    });
    expect(branched.result.status, branched.result.failure).toBe('generated');
    expect(branched.result.conversation!.branch?.quote).toBe(quote);
    expect(branched.result.canvas!.fork?.id).toBe(saved.id);
    expect(branched.result.originalUnchanged).toBe(true);
    expect(await canvases.read(1, saved.id)).toEqual(refined.result.canvas);
    expect(branched.result.canvas!.state.joint).toBe(0.25);
    expect(branched.result.execution).toBe('scripted-test');
    expect(await rehearsal.readJSON(path.join(root, 'Profile/config.jsonc'))).toMatchObject({
      settings: { providers: [], hotkey: { enabled: false } },
    });
    expect(await rehearsal.readJSON(path.join(root, 'Profile/viewer-state-v1.json'))).toMatchObject(
      {
        workspaces: [
          {
            name: 'SO-101 scripted test',
            roots: ['robot-canvas', 'robot-chat', 'robot-original'],
          },
        ],
      },
    );
    expect(await readdir(branched.folder)).toContain('previous-workspace.json');
  });

  it('rejects fabricated quotes and refuses to treat offline fixtures as live evidence', async () => {
    const { urdf } = await localProject();
    const options = {
      execution: 'scripted-test' as const,
      budget: { sessions: 3, requestsPerSession: 8 },
      provider,
      publicText: (text: string) => text,
    };
    const created = await runRobotSession(root, {
      ...options,
      stage: 'create',
      generate: scripted([
        step('canvas_source', { path: urdf }),
        step('canvas_robot_assets', { path: urdf }),
        step('canvas_write', { commandID: '2', text: '<p>Fixture</p>' }),
        step('reply', { text: 'Real fixture reply.' }),
      ]),
    });
    expect(created.result.status, created.result.failure).toBe('generated');
    const conversation = created.result.conversation!;
    const userMessage = conversation.messages.find((message) => message.role === 'user')!;
    expect(() => rehearsal.robotBranchRequest(conversation, userMessage.id, 0, 3)).toThrow(
      'attributed assistant',
    );
    expect(() => rehearsal.robotBranchRequest(conversation, randomUUID(), 0, 3)).toThrow(
      'attributed assistant',
    );
    const assistant = conversation.messages.find((message) => message.role === 'assistant')!;
    expect(() =>
      rehearsal.robotBranchRequest(conversation, assistant.id, 0, assistant.text.length + 1),
    ).toThrow('exact nonempty');
    await expect(
      runRobotSession(root, {
        ...options,
        stage: 'refine',
        execution: 'live-meta',
        reviewed: created.result.reviewToken,
        generate: scripted([]),
      }),
    ).rejects.toThrow('cannot continue a scripted test');
    const canvases = new Canvases(path.join(root, 'Profile'), { changed: () => {} });
    const canvas = created.result.canvas!;
    await canvases.write(
      1,
      canvas.id,
      canvas.revision,
      canvas.title,
      '<p>Hand-edited HTML</p>',
      {},
    );
    await expect(currentRobotSession(root, 'create')).rejects.toThrow('generated content');
    const store = new ChatDocumentStore(
      path.join(root, 'Profile/chat-documents', conversation.id + '.json'),
    );
    await store.save({
      ...conversation,
      messages: conversation.messages.map((message) =>
        message.id === assistant.id ? { ...message, text: 'A fabricated replacement.' } : message,
      ),
    });
    await expect(currentRobotSession(root, 'create')).rejects.toThrow('attribution changed');
  });
});
