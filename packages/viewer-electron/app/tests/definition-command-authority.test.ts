import { afterEach, expect, it, vi } from 'vitest';
import { Desktop } from '../src/desktop/bridge';
import type { DesktopEvent } from '../src/domain/contracts';

vi.mock('electron', () => ({ ipcMain: { removeHandler: vi.fn() } }));
afterEach(() => vi.useRealTimers());

function fixture() {
  const desktop = Object.create(Desktop.prototype) as Desktop;
  const commands = new Map<string, { finish(error?: string): void; owner: number }>();
  const sent = new Map<number, DesktopEvent[]>();
  Reflect.set(desktop, 'agentCommands', commands);
  Reflect.set(
    desktop,
    'windows',
    new Map(
      [7, 8].map((owner) => [
        owner,
        {
          window: {
            isDestroyed: () => false,
            webContents: {
              id: owner,
              isDestroyed: () => false,
              send: (_channel: string, event: DesktopEvent) => {
                sent.set(owner, [...(sent.get(owner) ?? []), event]);
              },
            },
          },
        },
      ]),
    ),
  );
  const dispatch = Reflect.get(desktop, 'dispatchAgentEvent').bind(desktop) as (
    owner: number,
    event: { type: 'agent-command'; command: string; target: object },
  ) => Promise<void>;
  const start = (owner: number) =>
    dispatch(owner, { type: 'agent-command', command: 'frame-all', target: {} });
  return { commands, sent, start };
}

it('publishes busy and idle terminal authority only to the window carrying the agent request', async () => {
  const f = fixture();
  const first = f.start(7);
  const second = f.start(8);
  expect(f.sent.get(7)?.[0]).toEqual({ type: 'terminal-authority', agentDriven: true });
  expect(f.sent.get(8)?.[0]).toEqual({ type: 'terminal-authority', agentDriven: true });
  [...f.commands.values()].find((item) => item.owner === 7)!.finish();
  await first;
  expect(f.sent.get(7)?.at(-1)).toEqual({ type: 'terminal-authority', agentDriven: false });
  expect(f.sent.get(8)?.at(-1)?.type).toBe('agent-command');
  [...f.commands.values()].find((item) => item.owner === 8)!.finish();
  await second;
  expect(f.sent.get(8)?.at(-1)).toEqual({ type: 'terminal-authority', agentDriven: false });
});

it('publishes idle authority when a renderer never answers its agent request', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const request = f.start(7);
  const failure = expect(request).rejects.toThrow('did not confirm');
  await vi.advanceTimersByTimeAsync(25000);
  await failure;
  expect(f.commands.size).toBe(0);
  expect(f.sent.get(7)?.at(-1)).toEqual({ type: 'terminal-authority', agentDriven: false });
});
