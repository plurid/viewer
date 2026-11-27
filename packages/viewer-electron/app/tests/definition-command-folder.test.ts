import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DefinitionCommands } from '../src/desktop/workspaces/definition-commands';
import { temporaryRoot } from '../tools/temporary';

const makeCommands = (cwd: string) =>
  new DefinitionCommands({
    lookup: () => ({
      command: 'npm run dev',
      cwd,
      paneCwd: cwd,
      profileID: 'default',
      workspaceName: 'Acme',
      basis: 'a'.repeat(64),
    }),
    terminals: {
      start: async () => {},
      profile: () => undefined,
      running: async () => false,
    },
    confirmations: {
      requireDefinitionCommands: async () => ({ kind: 'declined' }),
    },
    isAgentDriven: () => false,
    ownsWorkspace: () => true,
    window: () => undefined,
  });

const makeRequest = (cwd: string) => ({
  id: 'pane-1',
  workspaceID: 'ws-1',
  rootID: 'root-1',
  profileID: 'default',
  cols: 80,
  rows: 24,
  cwd,
});

const reference = { key: 'acme/app', plane: 0, basis: 'a'.repeat(64) };

describe('missing terminal subfolder reported as definition changed', () => {
  it('returns available when the terminal subfolder exists', async () => {
    const root = await temporaryRoot('viewer-probe-defcmd-');
    const existing = path.join(root, 'web');
    await mkdir(existing);
    const commands = makeCommands(existing);
    const result = await commands.inspect(1, makeRequest(existing), reference);
    expect(result.kind).toBe('available');
  });

  it('does not report changed when the definition and pane point to the same missing subfolder', async () => {
    const root = await temporaryRoot('viewer-probe-defcmd-missing-');
    const missing = path.join(root, 'web');
    const commands = makeCommands(missing);
    const result = await commands.inspect(1, makeRequest(missing), reference);
    expect(result.kind).toBe('folder-unavailable');
  });
});
