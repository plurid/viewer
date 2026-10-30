/**
 * Agent access starts only with the person's native Allow (desktop/bridge.ts): configuration and
 * Settings patches never grant it. A harness that needs it runs with --interactive in a supervised
 * terminal; Enter only shows each review, and the harness never answers a dialog itself.
 */
import assert from 'node:assert/strict';
import { createInterface } from 'node:readline/promises';
import type { AgentAccessRequest, AgentAccessState } from '../../../src/domain/agents/clients';
import { until } from '../../owned-app';
import type { NativeScenarioHarness } from './harness';
import { patchSettings } from './page';
import { pageCall } from './page-function';

type ReviewOutcome = { pending: boolean; state?: AgentAccessState; error?: string };
type ReviewWindow = { __agentAccessReview: ReviewOutcome };

/** Whether an operator runs this harness; without one, it stops before launching anything. */
export function operatorSession(harness: string): boolean {
  const interactive = process.argv.includes('--interactive');
  if (!interactive || !process.stdin.isTTY)
    throw new Error(
      `${harness} needs agent access, which only the person's native Allow grants. Run it with --interactive in a supervised terminal.`,
    );
  return interactive;
}

/** Opens a native review without waiting for it; the outcome lands on the window for `until`. */
function startReview(request: AgentAccessRequest): void {
  const page = window as unknown as ReviewWindow;
  page.__agentAccessReview = { pending: true };
  void window.viewer.agentAccess(request).then(
    (state) => {
      page.__agentAccessReview = { pending: false, state };
    },
    (error: Error) => {
      page.__agentAccessReview = { pending: false, error: error.message };
    },
  );
}

/** Asks, from Settings, for agent access to `roots`: one native Allow for the shared client and
 * one for the folders. */
export async function grantAgentAccess(
  settings: Pick<NativeScenarioHarness, 'evaluate'>,
  roots: string[],
): Promise<AgentAccessState> {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const reviews: [string, AgentAccessRequest][] = [
    [
      'Click Allow in “Allow local agent clients to use Viewer?”',
      { kind: 'enable', enabled: true },
    ],
    ['Click Allow in “Allow agents to use this folder?”', { kind: 'allow', roots }],
  ];
  try {
    // The folders wait in config.jsonc until their own Allow.
    await settings.evaluate(patchSettings({ path: 'settings.agents.roots', value: roots }));
    let state: AgentAccessState | undefined;
    for (const [instruction, request] of reviews) {
      console.log('Next: ' + instruction);
      const answer = await input.question('Press Enter to show this dialog, or type stop to end: ');
      if (answer.trim().toLowerCase() === 'stop') throw new Error('Stopped by the operator.');
      await settings.evaluate(pageCall(startReview, request));
      const outcome = await until(
        () =>
          settings.evaluate(
            pageCall(() => (window as unknown as ReviewWindow).__agentAccessReview),
          ),
        (value) => !value.pending,
        'native agent access review',
        600_000,
      );
      assert.equal(outcome.error, undefined, outcome.error ?? 'The native review completes.');
      state = outcome.state;
    }
    assert.ok(
      state?.enabled && roots.every((root) => state.roots.includes(root)),
      'The operator allowed agent access and its folders.',
    );
    return state;
  } finally {
    input.close();
  }
}
