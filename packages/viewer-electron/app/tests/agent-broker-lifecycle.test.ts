import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentBroker } from '../src/desktop/agents/agent-broker';
import { discardOwnTemporaryFile, removeEmptyDirectory } from '../src/desktop/operations/removal';
import { defaultSettings } from '../src/domain/services';
import type { FileServices } from '../src/desktop/files/file-services';
import type { ActionPlanner } from '../src/desktop/actions/planner';

vi.mock('../src/desktop/operations/removal', () => ({
  discardOwnTemporaryFile: vi.fn(async () => {}),
  removeEmptyDirectory: vi.fn(async () => {}),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function fixture() {
  // Exercise the public stop path without creating a listener or removing any real entry.
  const broker = new AgentBroker(
    '/fixture/Profile',
    () => defaultSettings('/fixture'),
    () => undefined,
    {} as FileServices,
    { all: async () => [], cancel: () => {} } as unknown as ActionPlanner,
  );
  const closeClients = vi.fn(async () => {});
  const closeServer = vi.fn((done: () => void) => done());
  const disconnect = vi.fn();
  Reflect.set(broker, 'clients', { close: closeClients, list: async () => [] });
  Reflect.set(broker, 'streams', new Set([{ destroy: disconnect }]));
  Reflect.set(broker, 'server', { close: closeServer });
  Reflect.set(broker, 'socketDirectory', '/fixture/owned-agent-socket');
  return { broker, closeClients, closeServer, disconnect };
}

describe('agent broker transport shutdown', () => {
  it('observes cancellation failures while client listing and startup are pending', async () => {
    const view = fixture();
    let finishListing!: () => void, finishStartup!: () => void;
    const listing = new Promise<never[]>((resolve) => {
      finishListing = () => resolve([]);
    });
    const startup = new Promise<void>((resolve) => {
      finishStartup = resolve;
    });
    Reflect.set(view.broker, 'clients', { close: view.closeClients, list: () => listing });
    Reflect.set(view.broker, 'starting', startup);
    vi.spyOn(view.broker, 'stop').mockRejectedValue(new Error('Unavailable task owner'));
    const closed = expect(view.broker.close()).rejects.toThrow(
      'Some agent work could not be stopped.',
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    finishListing();
    await new Promise<void>((resolve) => setImmediate(resolve));
    finishStartup();
    await closed;
    expect(view.closeClients).toHaveBeenCalledOnce();
    expect(view.closeServer).toHaveBeenCalledOnce();
    expect(view.disconnect).toHaveBeenCalledOnce();
  });
  it('serializes a restart behind shutdown instead of admitting work into the retiring listener', async () => {
    const view = fixture();
    Reflect.set(view.broker, 'server', undefined);
    vi.spyOn(view.broker.access, 'state').mockResolvedValue({
      enabled: true,
      roots: [],
      protectedRoots: [],
      capabilities: [],
      pending: { enable: false, roots: [] },
    });
    let finish!: () => void;
    const startup = new Promise<void>((resolve) => {
      finish = resolve;
    }).finally(() => {
      Reflect.set(view.broker, 'starting', undefined);
    });
    Reflect.set(view.broker, 'starting', startup);
    const open = vi.fn(async () => {});
    Reflect.set(view.broker, 'startNow', open);
    const closing = view.broker.close();
    const restarting = view.broker.start();
    await Promise.resolve();
    expect(open).not.toHaveBeenCalled();
    finish();
    await closing;
    await restarting;
    expect(open).toHaveBeenCalledOnce();
  });
  it.each(['preserve', 'no-removal'])(
    'retains its generated socket directory for %s runs',
    async (mode) => {
      vi.stubEnv('VIEWER_TEST_PRESERVE', mode === 'preserve' ? '1' : '0');
      vi.stubEnv('VIEWER_RENDER_TEST', '1');
      vi.stubEnv('VIEWER_DATA_DIRECTORY', '/fixture/Profile');
      vi.stubEnv('VIEWER_TEST_NO_REMOVAL', mode === 'no-removal' ? '1' : '0');
      const view = fixture();
      await view.broker.close();
      expect(view.closeClients).toHaveBeenCalledOnce();
      expect(view.closeServer).toHaveBeenCalledOnce();
      expect(view.disconnect).toHaveBeenCalledOnce();
      expect(discardOwnTemporaryFile).not.toHaveBeenCalled();
      expect(removeEmptyDirectory).not.toHaveBeenCalled();
      expect(Reflect.get(view.broker, 'socketDirectory')).toBeUndefined();
    },
  );

  it('keeps ordinary transport cleanup scoped to its one owned directory', async () => {
    vi.stubEnv('VIEWER_TEST_PRESERVE', '0');
    vi.stubEnv('VIEWER_TEST_NO_REMOVAL', '0');
    const view = fixture();
    await view.broker.close();
    expect(discardOwnTemporaryFile).toHaveBeenCalledExactlyOnceWith(
      '/fixture/owned-agent-socket/v.sock',
    );
    expect(removeEmptyDirectory).toHaveBeenCalledExactlyOnceWith('/fixture/owned-agent-socket');
    await view.broker.close();
    expect(removeEmptyDirectory).toHaveBeenCalledOnce();
  });
});
