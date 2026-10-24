import { describe, expect, it, vi } from 'vitest';
import { createWebHandlers } from '../src/desktop/ipc/web-handlers';
import type { LocalServer } from '../src/domain/previews/web';
import { schemas } from '../src/desktop/ipc/schemas';

const owner = 41;
const id = '11111111-1111-4111-8111-111111111111';
const server: LocalServer = {
  id,
  paneID: 'server-pane',
  root: '/fixtures/project',
  port: 41234,
  url: 'http://127.0.0.1:41234/',
  started: 1,
  state: 'running',
};

function ports() {
  return {
    previews: {
      openHtml: vi.fn(async () => ({ id, url: `viewer-html://${id}/index.html` })),
      closeHtml: vi.fn(async () => {}),
      start: vi.fn(async () => ({ ...server })),
      list: vi.fn(() => [{ ...server }]),
      inspect: vi.fn(() => ({ server: { ...server }, logs: [] })),
      stop: vi.fn(async () => {}),
      restart: vi.fn(async () => ({ ...server })),
      clearLog: vi.fn(),
      dispose: vi.fn(async () => {}),
      get: vi.fn((requestingOwner: number) => {
        if (requestingOwner !== owner) throw new Error('Server belongs to another window.');
        return { ...server };
      }),
    },
    resources: { editableFile: vi.fn(() => '/fixtures/project/index.html') },
    openURL: vi.fn(async () => {}),
    copyURL: vi.fn(async () => {}),
  } satisfies Parameters<typeof createWebHandlers>[0];
}

describe('native web preview handlers', () => {
  it('closes a late capability when its source resource expired while opening', async () => {
    const host = ports();
    host.resources.editableFile
      .mockReturnValueOnce('/fixtures/project/index.html')
      .mockImplementationOnce(() => {
        throw new Error('Resource expired.');
      });
    const handlers = createWebHandlers(host);
    await expect(handlers.htmlPreview(['resource'], owner)).rejects.toThrow('Resource expired');
    expect(host.previews.closeHtml).toHaveBeenCalledExactlyOnceWith(owner, id);
  });

  it('uses the caller ownership and reviewed folder identity when starting', async () => {
    const host = ports();
    await createWebHandlers(host).localServerStart(
      ['/fixtures/project', 'server-pane', '1:2'],
      owner,
    );
    expect(host.previews.start).toHaveBeenCalledExactlyOnceWith(
      owner,
      '/fixtures/project',
      'server-pane',
      '1:2',
    );
  });

  it.each(['open-browser', 'copy-url'] as const)(
    'resolves %s only from the requesting window’s live server',
    async (action) => {
      const host = ports();
      const handlers = createWebHandlers(host);
      await expect(handlers.localServerAction([id, action], owner + 1)).rejects.toThrow(
        'another window',
      );
      expect(host.openURL).not.toHaveBeenCalled();
      expect(host.copyURL).not.toHaveBeenCalled();
      await handlers.localServerAction([id, action], owner);
      const used = action === 'open-browser' ? host.openURL : host.copyURL;
      expect(used).toHaveBeenCalledExactlyOnceWith(server.url);
    },
  );

  it('does not launch a stale URL after the server has stopped', async () => {
    const host = ports();
    host.previews.get.mockReturnValue({ ...server, state: 'stopped' });
    await expect(
      createWebHandlers(host).localServerAction([id, 'open-browser'], owner),
    ).rejects.toThrow('Start the local server first');
    expect(host.openURL).not.toHaveBeenCalled();
  });

  it('rejects arbitrary addresses and filesystem actions at the IPC boundary', () => {
    expect(schemas.localServerAction.safeParse([id, 'remove-files']).success).toBe(false);
    expect(
      schemas.localServerAction.safeParse([id, 'open-browser', 'https://example.com']).success,
    ).toBe(false);
    expect(
      schemas.localServerStart.safeParse(['/fixtures/project', 'server-pane', 'forged']).success,
    ).toBe(false);
  });
});
