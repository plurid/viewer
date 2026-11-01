import { app, safeStorage } from 'electron';
import { mkdir, writeFile, realpath, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Chats } from '../../src/desktop/chat/service';
import { Canvases } from '../../src/desktop/canvases/service';
import { Credentials } from '../../src/desktop/models/providers';
import { providerResponseJSON } from '../../src/desktop/models/provider-response';
import {
  configuredEvaluationProvider,
  readEvaluationProviders,
} from '../../src/desktop/fabrication/evaluation';
import { inspectFile } from '../../src/desktop/files/inspection';
import { containsPath } from '../../src/desktop/files/containment';
import { setAssetRoot } from '../../src/desktop/native/assets';
import { defaultSettings } from '../../src/domain/services';
import type { ChatDocument, ChatReply } from '../../src/domain/models/chat';
import { canvasProject, canvasGoldenCases } from './sample';
import { temporaryRoot } from '../temporary';

app.setName('Viewer');
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const option = (key: string) => args[args.indexOf(key) + 1];
const profile = args.includes('--profile')
  ? path.resolve(option('--profile')!)
  : app.getPath('userData');
const sessionLimit = args.includes('--sessions') ? Number(option('--sessions')) : 3;
const continuation = args.includes('--continue') ? Number(option('--continue')) : undefined;
if (
  !args.includes('--live') ||
  !Number.isInteger(sessionLimit) ||
  sessionLimit < 1 ||
  sessionLimit > 8 ||
  args.some(
    (arg, i) =>
      !['--live', '--profile', '--resume', '--sessions', '--continue'].includes(arg) &&
      !['--profile', '--resume', '--sessions', '--continue'].includes(args[i - 1] ?? ''),
  )
)
  throw new Error(
    'Use --live, --profile <Viewer profile>, and optionally --resume <retained run> and --sessions <1 to 8>. Extending the default three sessions requires user approval.',
  );
process.env.VIEWER_TEST_PRESERVE = '1';
process.env.VIEWER_TEST_NO_REMOVAL = '1';
const resume = args.includes('--resume');
const root = await realpath(
  resume ? option('--resume')! : await temporaryRoot('viewer-canvas-evaluation-', '/tmp'),
);
app.setPath('userData', path.join(root, 'Electron'));
if (process.platform === 'darwin') app.setActivationPolicy('accessory');
let redact = (text: string) => text;
async function main() {
  await app.whenReady();
  setAssetRoot(false, fileURLToPath(new URL('../..', import.meta.url)));
  const configured = await readEvaluationProviders(profile);
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
  const authentication = await configuredEvaluationProvider(configured, credentials);
  redact = authentication.publicText;
  const provider = authentication.provider;
  const sample = path.join(root, 'Workshop kits');
  const files = resume
    ? ['Request.pdf', 'North.csv', 'East.csv'].map((name) => path.join(sample, name))
    : await canvasProject(sample);
  for (const file of files) {
    const inspected = await inspectFile(file, { content: true });
    if (inspected.coverage.content !== 'complete')
      throw new Error(
        'Sample inspection did not complete: ' +
          path.basename(file) +
          ': ' +
          inspected.coverage.reason,
      );
  }
  const storage = path.join(root, 'Profile');
  await mkdir(storage, { mode: 0o700, recursive: resume });
  const settings = { ...defaultSettings(root), providers: [provider] };
  const names = await readdir(root);
  let round = names.filter((name) => /^round-\d+-request.json$/.test(name)).length;
  let session = 0;
  let roundStart = round;
  const replay: { envelope: unknown; status: number }[] = [];
  let replayEnvelope: { envelope: unknown; status: number } | undefined;
  const recorded: typeof fetch = async (url, options) => {
    if (replayEnvelope) {
      const saved = replayEnvelope;
      replayEnvelope = undefined;
      return Response.json(saved.envelope, { status: saved.status });
    }
    const response = await fetch(url, options);
    const envelope = await providerResponseJSON(
      response.clone(),
      options?.signal ?? AbortSignal.timeout(120000),
    );
    await writeFile(
      path.join(root, `round-${round}-http.json`),
      redact(JSON.stringify({ status: response.status, envelope }, null, 2)),
      { flag: 'wx', mode: 0o600 },
    );
    return response;
  };
  const models = authentication.connect(recorded, {
    run: async (_provider, _level, signal, work) => work(signal),
  });
  const canvases = new Canvases(storage, { changed: () => {} });
  const unavailable = async (): Promise<never> => {
    throw new Error('The evaluation only inspects the sample and builds canvases.');
  };
  const chats = new Chats(storage, {
    canvases,
    settings: () => settings,
    access: async (paths) => {
      if (
        (await Promise.all(paths.map((file) => realpath(file)))).some(
          (file) => !containsPath(sample, file),
        )
      )
        throw new Error('Outside the sample project.');
    },
    inspect: (file, signal) => inspectFile(file, { content: true, signal }),
    generate: async (...input) => {
      if (replay.length) {
        replayEnvelope = replay.shift();
        return models.generate(...input);
      }
      if (round >= sessionLimit * 8 || session > sessionLimit || round - roundStart >= 8)
        throw new Error('The approved evaluation budget is exhausted.');
      const number = ++round;
      const started = Date.now();
      const record = {
        session,
        round: number,
        provider: { kind: provider.kind, model: provider.model },
        instructions: input[1],
        input: input[2],
        schema: input[3],
      };
      await writeFile(
        path.join(root, `round-${number}-request.json`),
        redact(JSON.stringify(record, null, 2)),
        { flag: 'wx', mode: 0o600 },
      );
      try {
        const response = await models.generate(...input);
        await writeFile(
          path.join(root, `round-${number}-response.json`),
          redact(JSON.stringify({ response, milliseconds: Date.now() - started }, null, 2)),
          { flag: 'wx', mode: 0o600 },
        );
        console.log(
          JSON.stringify({
            session,
            round: number,
            kind: (response as { kind?: string }).kind,
            milliseconds: Date.now() - started,
          }),
        );
        return response;
      } catch (error) {
        await writeFile(
          path.join(root, `round-${number}-error.json`),
          redact(JSON.stringify({ error: String(error) })),
          { flag: 'wx', mode: 0o600 },
        );
        throw error;
      }
    },
    permit: async (_provider, signal, work) => work(signal),
    command: unavailable,
    configuration: () => {
      throw new Error('No configuration proposals.');
    },
    rename: unavailable,
    valid: () => true,
    changed: () => {},
    aliases: () => new Map(),
  });
  const doc = (reply: ChatReply): ChatDocument => {
    if (Array.isArray(reply)) throw new Error('Expected a conversation.');
    return reply;
  };
  const origin = {
    target: {
      workspaceID: 'evaluation',
      paneID: 'folder',
      rootID: 'folder',
      directory: sample,
      selection: [],
    },
    commands: [],
  };
  const previous = await Promise.all(
    names
      .filter((name) => /^session-\d+.json$/.test(name))
      .sort(
        (a, b) => Number(a.split('-')[1]?.split('.')[0]) - Number(b.split('-')[1]?.split('.')[0]),
      )
      .map(async (name) => {
        const number = Number(name.split('-')[1]?.split('.')[0]);
        // Keep the original outcome and select the newest completed local recovery.
        const recovered = names
          .filter((candidate) =>
            new RegExp(`^session-${number}-recovered-\\d+\\.json$`).test(candidate),
          )
          .sort(
            (a, b) => Number(a.match(/(\d+)\.json$/)?.[1]) - Number(b.match(/(\d+)\.json$/)?.[1]),
          )
          .at(-1);
        return JSON.parse(await readFile(path.join(root, recovered ?? name), 'utf8')) as {
          conversation: ChatDocument;
          canvas?: { html: string };
        };
      }),
  );
  const started = names.filter((name) => /^session-\d+-started.json$/.test(name)).length;
  if (started !== previous.length)
    throw new Error(
      'An interrupted session must be inspected before resuming; no request was sent.',
    );
  let continuedRounds = 0;
  if (continuation !== undefined) {
    if (
      !resume ||
      continuation !== previous.length ||
      previous.at(-1)?.conversation.status !== 'failed'
    )
      throw new Error(
        'Only the last failed session can be continued after a local harness repair.',
      );
    const requests = names
      .filter((name) => /^round-\d+-request.json$/.test(name))
      .sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]));
    for (const name of requests) {
      const request = JSON.parse(await readFile(path.join(root, name), 'utf8')) as {
        session: number;
      };
      if (request.session !== continuation) continue;
      continuedRounds++;
      // Successful steps already changed the saved document. Replay only an unparsed response.
      if (names.includes(name.replace('-request', '-response'))) continue;
      const response = JSON.parse(
        await readFile(path.join(root, name.replace('-request', '-http')), 'utf8'),
      ) as { envelope: unknown; status: number };
      replay.push(response);
    }
    if (continuedRounds >= 8 || !replay.length)
      throw new Error('No remaining rounds or completed steps to replay.');
  }
  const successful = previous.filter(
    ({ conversation, canvas }) =>
      conversation.status === 'idle' && conversation.canvasID && canvas?.html.trim(),
  );
  let scenario = successful.length;
  const prior = continuation ? previous.at(-1)?.conversation : successful.at(-1)?.conversation;
  let conversation = doc(
    await chats.request(
      prior ? { kind: 'open', id: prior.id } : { kind: 'create', paths: files },
      1,
      origin,
    ),
  );
  const parentID = successful[0]?.conversation.id ?? conversation.id;
  const sessions = previous.map(({ conversation }, index) => ({
    session: index + 1,
    status: conversation.status,
    conversationID: conversation.id,
    canvasID: conversation.canvasID,
    error: conversation.error,
  }));
  console.log(
    JSON.stringify({
      root,
      model: provider.model,
      requests: sessionLimit,
      completedSessions: previous.length,
      maximumModelRounds: sessionLimit * 8,
      source: 'generated public sample only',
    }),
  );
  const prompts = [
    'Build an editable supplier comparison from these files. Use the actual quoted prices and project requirements. Let me change the quantity and budget; show the total for each supplier and the cheapest option. Include a button to save the comparison as CSV. Explain the initial comparison in your reply.',
    'I changed the quantity to 40. Add a maximum delivery time control starting at 3 days and show which supplier meets both the budget and deadline. Preserve my quantity and budget. Keep the CSV export and explain the recommendation.',
    'Explore the alternative of allowing 7 days for delivery. Add an explicit alternative-scenario control without changing the original requested deadline. Compare the extra time against the savings, and add a button to save a Markdown decision report. Keep the current inputs and CSV export.',
  ];
  try {
    for (
      session = continuation ?? previous.length + 1;
      session <= sessionLimit && scenario < 3;
      session++
    ) {
      const continuing = session === continuation;
      roundStart = round - (continuing ? continuedRounds : 0);
      if (scenario === 1 && conversation.canvasID) {
        const canvas = await canvases.read(1, conversation.canvasID);
        const quantity = Object.keys(canvas.state).find((key) => /quantity|qty|count/i.test(key));
        if (quantity)
          await canvases.state(1, canvas.id, canvas.stateRevision, canvas.revision, {
            [quantity]: 40,
          });
      }
      if (scenario === 2) {
        const selected = [...conversation.messages]
          .reverse()
          .find((message) => message.role === 'assistant');
        if (!selected || !conversation.canvasID)
          throw new Error(
            'No completed canvas reply to branch. The remaining session was not spent.',
          );
        conversation = doc(
          await chats.request(
            {
              kind: 'branch',
              id: conversation.id,
              revision: conversation.revision,
              messageID: selected.id,
              start: 0,
              end: Math.min(selected.text.length, 16000),
            },
            1,
          ),
        );
      }
      await writeFile(
        path.join(
          root,
          `session-${session}-${continuing ? 'continued-' + Date.now() : 'started'}.json`,
        ),
        JSON.stringify({ conversation: conversation.id, scenario, prompt: prompts[scenario] }),
        { flag: 'wx', mode: 0o600 },
      );
      await chats.request(
        { kind: 'send', id: conversation.id, text: prompts[scenario]!, providerID: provider.id },
        1,
      );
      const deadline = Date.now() + 130_000;
      do {
        await delay(200);
        conversation = doc(await chats.request({ kind: 'open', id: conversation.id }, 1, origin));
      } while (conversation.status === 'running' && Date.now() < deadline);
      if (conversation.status === 'running')
        await chats.request({ kind: 'stop', id: conversation.id }, 1);
      const canvas = conversation.canvasID
        ? await canvases.read(1, conversation.canvasID)
        : undefined;
      await writeFile(
        path.join(root, `session-${session}${continuing ? '-recovered-' + Date.now() : ''}.json`),
        redact(JSON.stringify({ conversation, canvas }, null, 2)),
        { flag: 'wx', mode: 0o600 },
      );
      if (continuing) sessions.pop();
      sessions.push({
        session,
        status: conversation.status,
        conversationID: conversation.id,
        canvasID: canvas?.id,
        error: conversation.error,
      });
      console.log(JSON.stringify(sessions.at(-1)));
      if (conversation.status !== 'idle' || !canvas?.html.trim()) break;
      scenario++;
    }
  } finally {
    await chats.close();
    await canvases.flush();
  }
  await writeFile(
    path.join(
      root,
      `evaluation-${sessions.length}${continuation ? '-recovered-' + Date.now() : ''}.json`,
    ),
    JSON.stringify(
      {
        execution: 'live-meta',
        root,
        model: provider.model,
        sessions,
        modelRounds: round,
        scenariosCompleted: scenario,
        sessionLimit,
        parentID,
        golden: canvasGoldenCases,
        limitations: [
          'Native rendering and functional results are checked separately; generation alone is not verification.',
        ],
      },
      null,
      2,
    ),
    { flag: 'wx', mode: 0o600 },
  );
  console.log(JSON.stringify({ root, sessions: sessions.length, modelRounds: round }));
  app.exit(0);
}
void main().catch(async (error: unknown) => {
  const message = redact(String(error));
  await writeFile(
    path.join(root, `failure-${Date.now()}.json`),
    JSON.stringify({ error: message }),
    {
      flag: 'wx',
      mode: 0o600,
    },
  );
  console.error(message);
  console.error('Retained evaluation: ' + root);
  app.exit(1);
});
