import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { RobotRehearsalLedger, digest, saveEvidence } from './rehearsal';

const grantSchema = z
  .object({
    sessions: z.number().int().min(1).max(3),
    requestsPerSession: z.number().int().min(1).max(8),
    approval: z.string().trim().min(1).max(1000),
  })
  .strict();

/** Called only after a separately recorded user approval, never by preparation or a test run. */
export async function authorizeStationRun(root: string, input: unknown) {
  const grant = grantSchema.parse(input);
  const plan = await readFile(path.join(root, 'plan.json'), 'utf8');
  if (JSON.parse(plan).contract !== 'generated-domain-v1')
    throw new Error('Prepare a fresh generated-tool experiment before authorizing calls.');
  const ledger = new RobotRehearsalLedger(root);
  if ((await ledger.sessions()).length) throw new Error('A started run cannot be reauthorized.');
  await saveEvidence(path.join(root, 'authorization.json'), {
    ...grant,
    planHash: digest(plan),
    at: new Date().toISOString(),
  });
  await ledger.authorize({
    sessions: grant.sessions,
    requestsPerSession: grant.requestsPerSession,
  });
}

export async function stationAuthorization(root: string) {
  const authorization = JSON.parse(await readFile(path.join(root, 'authorization.json'), 'utf8'));
  const grant = grantSchema.parse({
    sessions: authorization.sessions,
    requestsPerSession: authorization.requestsPerSession,
    approval: authorization.approval,
  });
  const plan = await readFile(path.join(root, 'plan.json'), 'utf8');
  const budget = JSON.parse(await readFile(path.join(root, 'budget.json'), 'utf8'));
  if (
    authorization.planHash !== digest(plan) ||
    JSON.parse(plan).contract !== 'generated-domain-v1' ||
    budget.sessions !== grant.sessions ||
    budget.requestsPerSession !== grant.requestsPerSession
  )
    throw new Error('The prepared experiment or request allowance changed after approval.');
  return grant;
}
