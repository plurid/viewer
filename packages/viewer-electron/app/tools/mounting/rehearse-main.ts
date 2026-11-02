import { app, safeStorage } from 'electron';
import { parseArgs } from 'node:util';
import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Credentials } from '../../src/desktop/models/providers';
import {
  configuredEvaluationProvider,
  readEvaluationProviders,
} from '../../src/desktop/fabrication/evaluation';
import { setAssetRoot } from '../../src/desktop/native/assets';
import { inspectFile } from '../../src/desktop/files/inspection';
import { Chats } from '../../src/desktop/chat/service';
import { ChatDocumentStore } from '../../src/desktop/chat/documents';
import { Canvases } from '../../src/desktop/canvases/service';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import type { SavedState } from '../../src/domain/contracts';
import type { ChatReply, ChatDocument } from '../../src/domain/models/chat';
import type { CanvasDocument } from '../../src/domain/canvases/document';
import { Storage } from '../../src/desktop/persistence/storage';
import { temporaryRoot } from '../temporary';
import {
  RobotRehearsalLedger,
  prepareRobotRehearsal,
  verifyRobotRehearsal,
  saveEvidence,
  readJSON,
  readRobotSessionResult,
  readEvidence,
  fingerprint,
  digest,
  robotRepairSchema,
} from '../robotics/rehearsal';
import { recordRobotRequests } from '../robotics/rehearsal-transport';
import { mountingBrief, mountingPrompt, comparisonPrompt } from './prompts';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    prepare: { type: 'string' },
    run: { type: 'string' },
    profile: { type: 'string' },
    live: { type: 'boolean' },
    'check-credentials': { type: 'boolean' },
    stage: { type: 'string' },
    reply: { type: 'string' },
    provider: { type: 'string' },
    'resume-same-session': { type: 'boolean' },
    effort: { type: 'string' },
    repair: { type: 'string' },
  },
});
if ([values.prepare, values.live, values['check-credentials']].filter(Boolean).length !== 1)
  throw new Error('Choose --prepare <pinned corpus>, --check-credentials or --live.');
if (!values.prepare && (!values.run || !values.profile))
  throw new Error('Supply --run <prepared run> and --profile <credential profile>.');
if (values.live && !['mounting', 'comparison'].includes(values.stage ?? ''))
  throw new Error('Choose --stage mounting|comparison.');
if (values.effort && !['minimal', 'low'].includes(values.effort))
  throw new Error('Choose --effort minimal|low or keep the configured effort.');
process.env.VIEWER_TEST_PRESERVE = '1';
process.env.VIEWER_TEST_NO_REMOVAL = '1';
const root = await realpath(
  values.prepare ? await temporaryRoot('viewer-mounting-meta-') : values.run!,
);
app.setPath('userData', path.join(root, 'Electron'));
if (process.platform === 'darwin') app.setActivationPolicy('accessory');
let redact = (text: string) => text;
const abort = new AbortController();
process.once('SIGINT', () => abort.abort());
process.once('SIGTERM', () => abort.abort());
const document = (reply: ChatReply): ChatDocument => {
  if (Array.isArray(reply)) throw new Error('Expected a conversation document.');
  return reply;
};

async function main() {
  await app.whenReady();
  setAssetRoot(false, fileURLToPath(new URL('../..', import.meta.url)));
  if (values.prepare) {
    await prepareRobotRehearsal(values.prepare, root);
    await mkdir(path.join(root, 'Inputs'));
    await mkdir(path.join(root, 'Output'));
    await saveEvidence(path.join(root, 'Inputs', 'mounting-brief.json'), mountingBrief);
    await saveEvidence(path.join(root, 'mounting-plan.json'), {
      kind: 'mounting-and-quotation',
      sessions: 2,
      requestsPerSession: 8,
      briefHash: fingerprint(mountingBrief),
      authorization: 'Allow two sessions, up to 16 new requests',
    });
    console.log(JSON.stringify({ root, status: 'prepared', providerRequests: 0 }));
    return;
  }
  const project = await verifyRobotRehearsal(root);
  const plan = await readJSON(path.join(root, 'mounting-plan.json'));
  if (
    fingerprint(plan) !==
    fingerprint({
      kind: 'mounting-and-quotation',
      sessions: 2,
      requestsPerSession: 8,
      briefHash: fingerprint(mountingBrief),
      authorization: 'Allow two sessions, up to 16 new requests',
    })
  )
    throw new Error('The approved mounting plan changed.');
  const brief = path.join(root, 'Inputs', 'mounting-brief.json');
  if (
    (await realpath(brief)) !== brief ||
    fingerprint(await readJSON(brief)) !== fingerprint(mountingBrief)
  )
    throw new Error('The mounting source changed.');
  const profile = await realpath(values.profile!);
  if (profile === root || profile.startsWith(root + path.sep))
    throw new Error('Credentials must remain outside the rehearsal.');
  const credentials = new Credentials(
    profile,
    async () => {
      throw new Error('Read-only credentials.');
    },
    async (bytes) => {
      if (!(await safeStorage.isAsyncEncryptionAvailable()))
        throw new Error('The OS key store is unavailable.');
      return (await safeStorage.decryptStringAsync(bytes)).result;
    },
  );
  const authentication = await configuredEvaluationProvider(
    await readEvaluationProviders(profile),
    credentials,
    values.provider,
  );
  const provider = values.effort
    ? { ...authentication.provider, effort: values.effort as 'minimal' | 'low' }
    : authentication.provider;
  redact = authentication.publicText;
  if (values['check-credentials']) {
    console.log(
      JSON.stringify({
        status: 'credentials-ready',
        model: authentication.provider.model,
        providerRequests: 0,
      }),
    );
    return;
  }
  const comparison = values.stage === 'comparison';
  const reply = comparison && values.reply ? await realpath(values.reply) : undefined;
  if (comparison && !reply)
    throw new Error('Comparison requires --reply <saved supplier-reply.json>.');
  const replyHash = reply ? digest(await readEvidence(reply, 64_000)) : undefined;
  const prompt = comparison ? comparisonPrompt(reply!) : mountingPrompt(project.urdf, brief);
  const ledger = new RobotRehearsalLedger(root);
  await ledger.authorize({ sessions: 2, requestsPerSession: 8 });
  const previous = await ledger.sessions();
  if (previous.length !== (comparison ? 1 : 0) + (values['resume-same-session'] ? 1 : 0))
    throw new Error('Use one mounting session followed by one comparison session.');
  const resumedResult = values['resume-same-session']
    ? ((await readRobotSessionResult(previous.at(-1)!)) as {
        conversation: ChatDocument;
      })
    : undefined;
  const repair = values.repair ? robotRepairSchema.parse(await readJSON(values.repair)) : undefined;
  if (repair && !values['resume-same-session'])
    throw new Error('Repair continues the same bounded session.');
  if (resumedResult && !resumedResult.conversation?.id)
    throw new Error('No interrupted conversation to continue.');
  const session = values['resume-same-session']
    ? await ledger.resume(comparison ? 'refine' : 'create', repair)
    : await ledger.begin(comparison ? 'refine' : 'create', {
        execution: 'live-meta',
        purpose: values.stage,
        prompt,
        reply,
        replyHash,
        provider: { kind: authentication.provider.kind, model: authentication.provider.model },
      });
  const storage = path.join(root, 'Profile');
  const canvases = new Canvases(storage, { changed: () => {} });
  if (repair)
    await canvases.observe(1, repair.canvasID, repair.revision, {
      status: 'error',
      message: repair.message,
    });
  const request = recordRobotRequests(session, fetch, redact, (event) =>
    console.log(JSON.stringify(event)),
  );
  const models = authentication.connect(request, {
    run: async (_provider, _level, signal, work) => work(signal),
  });
  const allowed = comparison
    ? new Set([reply!])
    : new Set([...project.allowed, ...project.directories, brief]);
  const unavailable = (): never => {
    throw new Error('This rehearsal reads scoped sources and writes private canvases only.');
  };
  const chats = new Chats(storage, {
    canvases,
    settings: () => ({ ...defaultSettings(root), providers: [provider] }),
    access: async (paths) => {
      for (const file of paths) {
        if ((await realpath(file)) !== file || !allowed.has(file))
          throw new Error('Outside the approved rehearsal sources.');
        if (reply && file === reply && digest(await readEvidence(reply, 64_000)) !== replyHash)
          throw new Error('The supplier reply changed.');
      }
    },
    inspect: (file, signal) => inspectFile(file, { content: true, signal }),
    generate: (provider, instructions, input, schema, signal, level, actor, protocol) => {
      if (!session.remainingRequests)
        throw new Error(
          'The approved request limit was reached. Published canvas content is retained.',
        );
      return models.generate(
        provider,
        instructions +
          `\nThis session has ${session.remainingRequests} requests left including this one and the final reply. Publish the complete canvas, then give your final reply.`,
        input,
        schema,
        signal,
        level,
        actor,
        protocol,
      );
    },
    permit: async (_provider, signal, work) => work(signal),
    command: unavailable,
    configuration: unavailable,
    rename: unavailable,
    valid: () => true,
    changed: () => {},
    aliases: () => new Map(),
  });
  let conversation: ChatDocument | undefined;
  let canvas: CanvasDocument | undefined;
  let failure: string | undefined;
  const origin = {
    target: {
      workspaceID: 'mounting',
      paneID: 'folder',
      rootID: 'folder',
      directory: root,
      selection: [],
    },
    commands: [],
  };
  try {
    conversation = document(
      await chats.request(
        resumedResult
          ? { kind: 'open', id: resumedResult.conversation.id }
          : { kind: 'create', paths: comparison ? [reply!] : [project.project, brief] },
        1,
        origin,
      ),
    );
    if (!conversation.canvasID)
      conversation = document(await chats.request({ kind: 'canvas', id: conversation.id }, 1));
    conversation = document(
      await chats.request(
        {
          kind: 'send',
          id: conversation.id,
          providerID: authentication.provider.id,
          text: resumedResult
            ? repair
              ? `Repair the existing canvas after native execution. Diagnostic evidence: ${JSON.stringify(repair.message)}. Read the complete current HTML and sources already in context; do not rebind or reread them. Preserve stable saved input keys and publish one complete corrected canvas_write, then give a brief final reply. ${session.remainingRequests} provider requests remain. Use the original requested title as query, not the string null.`
              : `Continue the interrupted request. All attached source snapshots, mesh assets and current canvas are already in your context. Do not read or bind them again. The current canvas has no functional interface, only a placeholder sentence. You have ${session.remainingRequests} requests left. In this response call canvas_write with the COMPLETE working HTML in text, using the current revision as commandID, then give a brief final reply. Follow the original task and design constraints. No placeholder, plan or description belongs in canvas_write.text.`
            : prompt,
        },
        1,
      ),
    );
    const deadline = Date.now() + 8 * 60_000;
    while (conversation.status === 'running' && Date.now() < deadline && !abort.signal.aborted) {
      await delay(200);
      conversation = document(
        await chats.request({ kind: 'open', id: conversation.id }, 1, origin),
      );
    }
    if (conversation.status === 'running')
      conversation = document(await chats.request({ kind: 'stop', id: conversation.id }, 1));
    if (conversation.status !== 'idle')
      throw new Error(conversation.error ?? 'The session did not complete.');
    canvas = await canvases.read(1, conversation.canvasID!);
    if (!canvas.html.trim() || !canvas.sources.length || (!comparison && !canvas.assets.length))
      throw new Error('The session did not publish a source-bound canvas.');
  } catch (error) {
    failure = redact(String(error));
  } finally {
    await chats.close();
    await canvases.flush();
    if (conversation) {
      conversation =
        (await new ChatDocumentStore(
          path.join(storage, 'chat-documents', conversation.id + '.json'),
        ).load()) ?? conversation;
      if (conversation.canvasID) canvas = await canvases.read(1, conversation.canvasID);
    }
  }
  const result = {
    execution: 'live-meta',
    purpose: values.stage,
    status: failure ? 'failed' : 'generated',
    failure,
    conversation,
    canvas,
  };
  await session.finish(JSON.parse(redact(JSON.stringify(result))));
  if (canvas?.html && conversation) {
    const settings = defaultSettings(root);
    settings.providers = [];
    settings.hotkey.enabled = false;
    if (!comparison) {
      try {
        await saveEvidence(path.join(storage, 'config.jsonc'), {
          version: 1,
          settings,
          ui: normalizePreferences(),
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    const workspace = new Storage(path.join(storage, 'viewer-state-v1.json'));
    const previousState = (await workspace.load()).state;
    const state: SavedState = {
      version: CURRENT_STATE_VERSION,
      activeWorkspace: values.stage!,
      favorites: [],
      recents: [],
      look: 'dark',
      workspaces: [
        ...(previousState?.workspaces ?? []).filter((workspace) => workspace.id !== values.stage),
        {
          id: values.stage!,
          name: comparison ? 'Cutting quote' : 'SO-101 mounting',
          panes: [
            {
              id: values.stage! + '-canvas',
              type: 'canvas',
              canvasID: canvas.id,
              path: root,
              title: canvas.title,
            },
            {
              id: values.stage! + '-chat',
              type: 'chat',
              conversationID: conversation.id,
              path: root,
            },
          ],
          roots: [values.stage! + '-canvas', values.stage! + '-chat'],
          activePane: values.stage! + '-canvas',
          arrangement: {},
        },
      ],
    };
    await saveEvidence(path.join(session.folder, `review-workspace-${Date.now()}.json`), state);
    await workspace.save(state);
  }
  console.log(
    JSON.stringify({
      root,
      folder: session.folder,
      status: result.status,
      failure,
      requests: 8 - session.remainingRequests,
      canvasID: canvas?.id,
      note: 'Generation is not native qualification.',
    }),
  );
  if (failure) process.exitCode = 1;
}
void main()
  .then(() => app.exit(Number(process.exitCode ?? 0)))
  .catch(async (error: unknown) => {
    console.error(redact(String(error)));
    console.error('Retained rehearsal: ' + root);
    app.exit(1);
  });
