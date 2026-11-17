// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import type { DesktopEvent } from '../src/domain/contracts';
import { terminalSession, trimTerminals } from '../src/renderer/terminals/sessions';

const fake = vi.hoisted(() => ({
  opened: vi.fn(),
  options: undefined as unknown,
  output: [] as string[],
  input: undefined as ((data: string) => void) | undefined,
}));
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    constructor(options: unknown) {
      fake.options = options;
    }
    open(element: HTMLElement) {
      fake.opened(element.isConnected);
    }
    loadAddon() {}
    attachCustomKeyEventHandler() {}
    onResize() {}
    dispose() {}
    onData(callback: typeof fake.input) {
      fake.input = callback;
    }
    write(data: string, acknowledged: () => void) {
      fake.output.push(data);
      if (data === '\x1b[5n') fake.input?.('\x1b[0n');
      acknowledged?.();
    }
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }));

it('opens an offscreen emulator and answers the first PTY query before the batch reply resolves', async () => {
  let receive: ((event: DesktopEvent) => void) | undefined;
  let deliverInput!: () => void;
  const queued = new Promise<void>((resolve) => {
    deliverInput = resolve;
  });
  const write = vi.fn(async (_id: string, data: string) => {
    if (data === 'held input') await queued;
  });
  Object.assign(window, {
    viewer: {
      onEvent: (listener: typeof receive) => {
        receive = listener;
      },
      terminalWrite: write,
      terminalAck: vi.fn(async () => {}),
      terminalResize: vi.fn(async () => {}),
      terminalClose: vi.fn(async () => {}),
    },
  });
  const request = {
    id: 'handoff',
    workspaceID: 'workspace',
    rootID: 'handoff',
    cwd: '/fixture',
    profileID: 'login',
    cols: 80,
    rows: 24,
  };
  const session = await terminalSession(request, 1000);
  let finish!: () => void;
  session.starting = new Promise<void>((resolve) => {
    finish = resolve;
  });
  session.input = 'held input';
  try {
    session.park?.();
    expect(fake.opened).toHaveBeenCalledWith(true);
    expect(fake.options).toMatchObject({ windowOptions: { getWinSizeChars: true } });
    receive?.({ type: 'terminal', event: { type: 'data', id: request.id, data: '\x1b[5n' } });
    receive?.({ type: 'terminal', event: { type: 'data', id: request.id, data: 'second chunk' } });
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith(request.id, '\x1b[0n'));
    expect(fake.output).toEqual(['\x1b[5n', 'second chunk']);
    expect(window.viewer.terminalResize).toHaveBeenCalledWith(request.id, 80, 24);
    expect(session.started).toBe(true);
    const visible = document.createElement('div');
    document.body.append(visible);
    session.attach(visible);
    session.park?.();
    expect(session.element.isConnected).toBe(true);
    expect(fake.opened).toHaveBeenCalledOnce();
  } finally {
    deliverInput();
    finish();
    trimTerminals(new Set());
  }
});
