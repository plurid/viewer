import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentBroker } from '../src/desktop/agents/agent-broker';
import { discardOwnTemporaryFile, removeEmptyDirectory } from '../src/desktop/operations/removal';

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
  const broker = Object.create(AgentBroker.prototype) as AgentBroker;
  const closeClients = vi.fn(async () => {});
  const closeServer = vi.fn((done: () => void) => done());
  const disconnect = vi.fn();
  Reflect.set(broker, 'clients', { close: closeClients });
  Reflect.set(broker, 'streams', new Set([{ destroy: disconnect }]));
  Reflect.set(broker, 'server', { close: closeServer });
  Reflect.set(broker, 'socketDirectory', '/fixture/owned-agent-socket');
  return { broker, closeClients, closeServer, disconnect };
}

describe('agent broker transport shutdown', () => {
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
