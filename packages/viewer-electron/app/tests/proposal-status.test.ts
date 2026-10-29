/**
 * A reviewed agent proposal leaves one durable record when it reaches a final status. Saving
 * that record could fail without trace; the failure now reaches the diagnostic log.
 */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  finalProposalStatuses,
  isFinalProposalStatus,
  type ProposalStatus,
} from '../src/domain/agents/requests';

it('names the final statuses once', () => {
  const statuses: ProposalStatus[] = ['review', 'running', ...finalProposalStatuses];
  expect(statuses.filter(isFinalProposalStatus)).toEqual([
    'completed',
    'failed',
    'rejected',
    'cancelled',
  ]);
});

it('reports a review record that was not saved', () => {
  const bridge = readFileSync(new URL('../src/desktop/bridge.ts', import.meta.url), 'utf8');
  const start = bridge.indexOf('  private auditProposal(');
  const method = bridge.slice(start, bridge.indexOf('\n  }\n', start));
  expect(method).toContain('An agent review record was not saved');
  expect(method).not.toContain('.catch(() => {})');
  expect(method).not.toMatch(/ as '/);
});
