import { app, safeStorage } from 'electron';
import { parseArgs } from 'node:util';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Credentials } from '../../src/desktop/models/providers';
import {
  configuredEvaluationProvider,
  readEvaluationProviders,
} from '../../src/desktop/fabrication/evaluation';
import { setAssetRoot } from '../../src/desktop/native/assets';
import { inspectFile } from '../../src/desktop/files/inspection';
import { sourceSnapshot } from '../../src/desktop/canvases/sources';
import {
  robotStageSchema,
  robotRepairSchema,
  readJSON,
  saveEvidence,
  verifyRobotRehearsal,
} from './rehearsal';
import { runRobotSession } from './rehearsal-session';
import { recordRobotRequests } from './rehearsal-transport';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    live: { type: 'boolean' },
    check: { type: 'boolean' },
    'check-credentials': { type: 'boolean' },
    run: { type: 'string' },
    profile: { type: 'string' },
    provider: { type: 'string' },
    stage: { type: 'string' },
    sessions: { type: 'string' },
    'requests-per-session': { type: 'string' },
    reviewed: { type: 'string' },
    repair: { type: 'string' },
    'quote-message': { type: 'string' },
    'quote-start': { type: 'string' },
    'quote-end': { type: 'string' },
  },
});
if ([values.check, values['check-credentials'], values.live].filter(Boolean).length !== 1)
  throw new Error('Choose an offline check, a credential check or an approved live session.');
if (
  !values.run ||
  (!values.check && !values.profile) ||
  (values.live && (!values.stage || !values.sessions || !values['requests-per-session']))
)
  throw new Error(
    'An approved run requires --live --run <prepared run> --profile <Viewer profile> --stage create|refine|branch --sessions <approved total> --requests-per-session <approved maximum>.',
  );
const stage = values.live ? robotStageSchema.parse(values.stage) : undefined;
const budget = {
  sessions: Number(values.sessions),
  requestsPerSession: Number(values['requests-per-session']),
};
const root = await realpath(values.run);
const profile = values.check ? undefined : await realpath(values.profile!);
if (profile && (root === profile || profile.startsWith(root + path.sep)))
  throw new Error('Use the real credential profile separately from the rehearsal.');
process.env.VIEWER_TEST_PRESERVE = '1';
process.env.VIEWER_TEST_NO_REMOVAL = '1';
app.setPath('userData', path.join(root, 'Electron'));
if (process.platform === 'darwin') app.setActivationPolicy('accessory');
const abort = new AbortController();
process.once('SIGINT', () => abort.abort());
process.once('SIGTERM', () => abort.abort());
let redact = (text: string) => text;

async function main() {
  await app.whenReady();
  setAssetRoot(false, fileURLToPath(new URL('../..', import.meta.url)));
  const project = await verifyRobotRehearsal(root);
  if (values.check) {
    const source = sourceSnapshot(await inspectFile(project.urdf, { content: true }));
    if (!source.data.robot) throw new Error('The desktop reader did not load the robot.');
    console.log(
      JSON.stringify({
        root,
        status: 'offline-ready',
        links: source.data.robot.links.length,
        joints: source.data.robot.joints.length,
        providerRequests: 0,
      }),
    );
    app.exit(0);
    return;
  }
  const credentials = new Credentials(
    profile!,
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
    await readEvaluationProviders(profile!),
    credentials,
    values.provider,
  );
  redact = authentication.publicText;
  if (values['check-credentials']) {
    console.log(
      JSON.stringify({
        root,
        status: 'credentials-ready',
        model: authentication.provider.model,
        providerRequests: 0,
      }),
    );
    app.exit(0);
    return;
  }
  const result = await runRobotSession(root, {
    stage: stage!,
    budget,
    execution: 'live-meta',
    provider: authentication.provider,
    signal: abort.signal,
    publicText: redact,
    reviewed: values.reviewed,
    repair: values.repair ? robotRepairSchema.parse(await readJSON(values.repair)) : undefined,
    quote: values['quote-message']
      ? {
          messageID: values['quote-message'],
          start: Number(values['quote-start']),
          end: Number(values['quote-end']),
        }
      : undefined,
    generate: (session) => {
      const request = recordRobotRequests(session, fetch, redact, (event) =>
        console.log(JSON.stringify({ stage, ...event })),
      );
      const models = authentication.connect(request, {
        run: async (_provider, _level, signal, work) => work(signal),
      });
      return (provider, instructions, input, schema, signal, level, actor, protocol) =>
        models.generate(
          provider,
          instructions +
            '\nThis session has ' +
            session.remainingRequests +
            ' provider requests remaining, including this request and the final reply. The full current canvas is already in context; do not read identical content again. After a successful canvas_write, give your final reply unless there is new failure evidence.',
          input,
          schema,
          signal,
          level,
          actor,
          protocol,
        );
    },
  });
  console.log(
    JSON.stringify(
      {
        folder: result.folder,
        stage,
        status: result.result.status,
        reviewToken: result.result.reviewToken,
        failure: result.result.failure,
        note: 'Generation is not qualification. Review the saved tool in Viewer before another stage.',
      },
      null,
      2,
    ),
  );
  app.exit(result.result.status === 'generated' ? 0 : 1);
}
void main().catch(async (error: unknown) => {
  const message = redact(String(error));
  await saveEvidence(path.join(root, `failure-${Date.now()}.json`), { error: message }).catch(
    () => {},
  );
  console.error(message);
  console.error('Retained rehearsal: ' + root);
  app.exit(1);
});
