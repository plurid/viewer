import { realpath } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TerminalEvent } from '../src/domain/automation/actions';
import { terminalReadCharacters } from '../src/domain/agents/requests';
import { defaultSettings } from '../src/domain/services';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const fake = vi.hoisted(() => ({
  receive: undefined as ((message: unknown) => void) | undefined,
  postMessage: vi.fn(),
}));
vi.mock('../src/desktop/workers/utility-client', () => ({
  launchWorker: () => ({
    postMessage: fake.postMessage,
    message: (receive: typeof fake.receive) => {
      fake.receive = receive;
    },
    exit: () => {},
  }),
}));
vi.mock('../src/desktop/terminals/terminal-groups', () => ({
  terminateTerminalGroup: vi.fn(async () => {}),
}));
import { Terminals } from '../src/desktop/terminals/terminals';

let root: string | undefined;
afterEach(async () => {
  if (root) await trashTemporary(root);
  root = undefined;
});

describe('terminal output an agent reads (2026-10-30)', () => {
  // Settings promised the last 128 KB; the terminal keeps characters, not bytes.
  it('keeps the last characters the read grant names, counted as characters', async () => {
    root = await realpath(await temporaryRoot('viewer-terminal-read-'));
    fake.postMessage.mockImplementation((request: { kind: string; id: string }) => {
      if (request.kind === 'close')
        queueMicrotask(() => fake.receive?.({ type: 'exit', id: request.id, code: 0 }));
    });
    const settings = defaultSettings(root);
    const terminals = new Terminals(
      '/never-launched-worker.cjs',
      () => settings,
      () => {},
    );
    try {
      await terminals.start(
        {
          id: 'shell',
          workspaceID: 'workspace',
          rootID: 'folder',
          cwd: root,
          profileID: settings.terminals.profileID,
          cols: 80,
          rows: 24,
        },
        7,
      );
      // é and € take two and three bytes in UTF-8: a byte limit would keep far fewer
      const shown = 'é€'.repeat(terminalReadCharacters);
      fake.receive?.({ type: 'data', id: 'shell', data: shown } satisfies TerminalEvent);
      const { output } = terminals.agentRead('shell');
      expect(output).toHaveLength(terminalReadCharacters);
      expect(output).toBe(shown.slice(-terminalReadCharacters));
    } finally {
      await terminals.close();
    }
  });
});
