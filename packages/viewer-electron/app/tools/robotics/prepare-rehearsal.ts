import { parseArgs } from 'node:util';
import { realpath } from 'node:fs/promises';
import { temporaryRoot } from '../temporary';
import { prepareRobotRehearsal, robotStageSchema, verifyRobotRehearsal } from './rehearsal';
import { currentRobotSession, robotRehearsalStatus } from './rehearsal-session';

const { values } = parseArgs({
  options: {
    corpus: { type: 'string' },
    status: { type: 'string' },
    stage: { type: 'string' },
  },
});
if (
  (!values.corpus && !values.status) ||
  (values.corpus && values.status) ||
  (values.stage && !values.status)
)
  throw new Error(
    'Use --corpus <retained pinned corpus>, or --status <rehearsal run> [--stage create|refine|branch]. No provider is contacted.',
  );
process.env.VIEWER_TEST_PRESERVE = '1';
process.env.VIEWER_TEST_NO_REMOVAL = '1';
if (values.corpus) {
  const root = await realpath(await temporaryRoot('viewer-robot-rehearsal-'));
  await prepareRobotRehearsal(values.corpus, root);
  console.log(
    JSON.stringify(
      { root, status: 'prepared', providerRequests: 0, plan: root + '/plan.json' },
      null,
      2,
    ),
  );
} else {
  const root = await realpath(values.status!);
  await verifyRobotRehearsal(root);
  const sessions = await robotRehearsalStatus(root);
  const stage = values.stage
    ? robotStageSchema.parse(values.stage)
    : sessions.findLast(({ result }) => result.status === 'generated')?.result.stage;
  const current = stage ? await currentRobotSession(root, stage) : undefined;
  console.log(
    JSON.stringify(
      {
        root,
        sessions: sessions.map(({ folder, result }) => ({
          folder,
          stage: result.stage,
          status: result.status,
          failure: result.failure,
        })),
        reviewToken: current?.reviewToken,
        canvasID: current?.canvas.id,
        state: current?.canvas.state,
        assistantPassages: current?.conversation.messages
          .filter((message) => message.role === 'assistant' && message.provider)
          .map(({ id, text }) => ({ messageID: id, text })),
        note: 'The token identifies saved content. It does not perform native or visual verification.',
      },
      null,
      2,
    ),
  );
}
