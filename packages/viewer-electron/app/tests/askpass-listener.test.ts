import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { AskpassRelay } from '../src/desktop/remote/askpass';
const fixture = vi.hoisted(() => ({ create: vi.fn(), folder: vi.fn(), chmod: vi.fn() }));
vi.mock('node:net', () => ({ createServer: fixture.create }));
vi.mock('node:fs/promises', () => ({ chmod: fixture.chmod }));
vi.mock('../src/desktop/remote/socket-folder', () => ({
  privateSocketFolder: fixture.folder,
  removeSocketFolder: async () => {},
}));
it('retries failed setup and retires attempts after a listener error', async () => {
  fixture.folder.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue('/tmp/fixture');
  const server = Object.assign(new EventEmitter(), {
    listen: (_file: string, ready: () => void) => ready(),
    close: vi.fn((done?: () => void) => done?.()),
  });
  fixture.create.mockReturnValue(server);
  const relay = new AskpassRelay('helper', async () => null);
  await expect(relay.begin('one', 'One', 1)).rejects.toThrow('Unavailable');
  const attempt = await relay.begin('two', 'Two', 1);
  expect(() => server.emit('error', new Error('Listener failed'))).not.toThrow();
  expect(attempt.signal.aborted).toBe(true);
  await relay.close();
});

it('rejects a listener error during permission setup and reuses its private folder on retry', async () => {
  fixture.folder.mockClear().mockResolvedValue('/tmp/private-fixture');
  const makeServer = () =>
    Object.assign(new EventEmitter(), {
      listen: (_path: string, ready: () => void) => ready(),
      close: (done?: () => void) => done?.(),
    });
  const server = makeServer();
  fixture.create.mockReturnValueOnce(server).mockReturnValueOnce(makeServer());
  fixture.chmod.mockImplementationOnce(async () => {
    server.emit('error', new Error('Setup interrupted'));
  });
  const relay = new AskpassRelay('helper', async () => null);
  try {
    await expect(relay.begin('one', 'One', 1)).rejects.toThrow('Setup interrupted');
    expect((await relay.begin('two', 'Two', 1)).signal.aborted).toBe(false);
    expect(fixture.folder).toHaveBeenCalledTimes(1);
  } finally {
    await relay.close();
  }
});
