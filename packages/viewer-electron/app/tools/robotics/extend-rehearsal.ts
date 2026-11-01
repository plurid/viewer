import { parseArgs } from 'node:util';
import { realpath } from 'node:fs/promises';
import { RobotRehearsalLedger, verifyRobotRehearsal } from './rehearsal';

const { values } = parseArgs({
  options: {
    run: { type: 'string' },
    sessions: { type: 'string' },
    requests: { type: 'string' },
    approval: { type: 'string' },
  },
});
if (!values.run || !values.sessions || !values.requests || !values.approval)
  throw new Error('An explicit extension requires --run, --sessions, --requests and --approval.');
const root = await realpath(values.run);
await verifyRobotRehearsal(root);
const extension = await new RobotRehearsalLedger(root).extend(
  Number(values.sessions),
  Number(values.requests),
  values.approval,
);
console.log(JSON.stringify({ root, extension, providerRequests: 0 }, null, 2));
