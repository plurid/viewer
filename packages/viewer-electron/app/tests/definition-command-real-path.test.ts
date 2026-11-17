import { createRequire } from 'node:module';
import { realpath, writeFile } from 'node:fs/promises';
import type * as NativePty from 'node-pty';
import type { Terminal } from '@xterm/xterm';
import { expect, it, vi } from 'vitest';
import type {
  TerminalWorkerReply,
  TerminalWorkerRequest,
} from '../src/desktop/terminals/terminal-protocol';
import { defaultSettings } from '../src/domain/services';
import { terminalWindowOptions } from '../src/domain/terminals/window-options';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import { sampleDefinition, sampleWorkspace } from './workspace-definition-fixtures';
import { ExecutionConfirmations } from '../src/desktop/actions/execution-confirmations';
import { DefinitionCommands } from '../src/desktop/workspaces/definition-commands';
import { definitionCommandLookup } from '../src/desktop/workspaces/definition-command-lookup';
import { createTerminalHandlers } from '../src/desktop/ipc/terminal-handlers';
import { schemas } from '../src/desktop/ipc/schemas';

const fake = vi.hoisted(() => ({
  receive: undefined as ((event: { data: TerminalWorkerRequest }) => void) | undefined,
  desktop: undefined as ((reply: TerminalWorkerReply) => void) | undefined,
  writes: [] as string[],
  messages: [] as TerminalWorkerRequest[],
}));
vi.mock('node-pty', () => {
  const native = createRequire(import.meta.url)(
    process.env.VIEWER_TEST_PTY_MODULE || 'node-pty',
  ) as typeof NativePty;
  return {
    spawn: (...args: Parameters<typeof native.spawn>) => {
      const process = native.spawn(...args);
      const write = process.write.bind(process);
      process.write = (data: string) => {
        fake.writes.push(data);
        write(data);
      };
      return process;
    },
  };
});
vi.mock('../src/desktop/workers/worker-port', () => ({
  workerPort: {
    postMessage: (reply: TerminalWorkerReply) => fake.desktop?.(reply),
    on: (_type: string, receive: typeof fake.receive) => {
      fake.receive = receive;
    },
  },
}));
vi.mock('../src/desktop/workers/utility-client', () => ({
  launchWorker: () => ({
    postMessage: (request: TerminalWorkerRequest) => {
      fake.messages.push(request);
      fake.receive?.({ data: request });
    },
    message: (receive: typeof fake.desktop) => {
      fake.desktop = receive;
    },
    exit: () => {},
  }),
}));
vi.mock('../src/desktop/terminals/terminal-groups', () => ({
  terminateTerminalGroup: async () => {},
}));
import { Terminals } from '../src/desktop/terminals/terminals';

it('runs a clicked catalog command through IPC, approval, Terminals, the real worker and real zsh', async (context) => {
  if (!process.env.VIEWER_TEST_PTY_MODULE)
    context.skip(
      'Set VIEWER_TEST_PTY_MODULE to a host-compatible node-pty module. The worker native suite probes installed support separately.',
    );
  const root = await realpath(await temporaryRoot('viewer-definition-real-path-'));
  await writeFile(
    root + '/.zshrc',
    "print -n -- $'\\e[18t'\nread -rk 10 reply\nprint -r -- SIZE_ANSWERED\nPS1='fixture> '\n",
    { flag: 'wx' },
  );
  const native = createRequire(import.meta.url)('@xterm/xterm') as { Terminal: typeof Terminal };
  const emulator = new native.Terminal({
    cols: 80,
    rows: 24,
    windowOptions: terminalWindowOptions,
  });
  const settings = defaultSettings(root);
  settings.terminals.profiles[0]!.executable = '/bin/zsh';
  settings.terminals.profiles[0]!.args = ['-i'];
  settings.terminals.profiles[0]!.env = { ZDOTDIR: root };
  const definition = sampleDefinition('sample/site', {
    basis: 'shown',
    planes: [
      {
        index: 0,
        plane: { kind: 'terminal', path: root, command: 'print -r -- WHOLE_PATH_$((40+2))' },
      },
    ],
  });
  const workspace = sampleWorkspace('workspace', {
    definition: { key: definition.key, basis: definition.basis },
    panes: [
      { id: 'terminal', type: 'terminal', path: root, profileID: 'login', definitionPlane: 0 },
    ],
  });
  let output = '';
  const terminals = new Terminals(
    '/fixture/worker.cjs',
    () => settings,
    (_owner, event) => {
      if (event.type === 'data') {
        output += event.data;
        emulator.write(event.data);
        terminals.ack(event.id, event.data.length, 7);
      }
    },
  );
  emulator.onData((data) => terminals.write('terminal', data, 7));
  const ask = vi.fn(async () => true);
  const confirmations = new ExecutionConfirmations(root, ask);
  const commands = new DefinitionCommands({
    lookup: definitionCommandLookup({
      window: () => ({ workspaceID: workspace.id, workspaces: [workspace] }),
      definition: () => definition,
      defaultProfile: () => 'login',
    }),
    terminals,
    confirmations,
    isAgentDriven: () => false,
    ownsWorkspace: () => true,
    window: () => undefined,
  });
  const handlers = createTerminalHandlers({
    terminals,
    definitionCommands: commands,
  } as unknown as Parameters<typeof createTerminalHandlers>[0]);
  try {
    await import('../src/desktop/terminals/terminal-worker');
    expect(fake.messages).toEqual([]);
    const request = {
      id: 'terminal',
      workspaceID: workspace.id,
      rootID: 'terminal',
      cwd: root,
      profileID: 'login',
      cols: 80,
      rows: 24,
    };
    await handlers.terminalStart(
      schemas.terminalStart.parse([request, { key: definition.key, plane: 0, basis: 'shown' }]),
      7,
    );
    await vi.waitFor(() => expect(output).toContain('WHOLE_PATH_42'), { timeout: 5000 });
    expect(output).toContain('SIZE_ANSWERED');
    expect(fake.writes).toEqual(['\x1b[8;24;80t', '\x1bS\x15print -r -- WHOLE_PATH_$((40+2))\r']);
    expect(ask).toHaveBeenCalledOnce();
    expect(fake.messages.filter((item) => item.kind === 'start')).toHaveLength(1);
  } finally {
    await terminals.close();
    emulator.dispose();
    await trashTemporary(root);
  }
});
