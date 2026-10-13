import { describe, expect, it, vi } from 'vitest';
import { copyBrowserPaths } from './browser-clipboard';
describe('browser Copy Path', () => {
  it('writes exact multi-path text before clearing the old file-operation clipboard', async () => {
    const events: string[] = [];
    const complete = vi.fn(async () => {
      events.push('clear-files');
    });
    const clipboard = {
      writeText: vi.fn(async (text: string) => {
        events.push(text);
      }),
    };
    await copyBrowserPaths(
      ['/fixture/ș 日本語.txt', '/fixture/folder with spaces'],
      complete,
      clipboard,
    );
    expect(events).toEqual(['/fixture/ș 日本語.txt\n/fixture/folder with spaces', 'clear-files']);
  });
  it('reports denied clipboard permission and preserves the previous file selection', async () => {
    const complete = vi.fn(async () => {});
    const clipboard = {
      writeText: vi.fn(async () => {
        throw new DOMException('Denied', 'NotAllowedError');
      }),
    };
    await expect(copyBrowserPaths(['/fixture/file'], complete, clipboard)).rejects.toThrow(
      'clipboard',
    );
    expect(complete).not.toHaveBeenCalled();
  });
  it('does not claim success when the browser clipboard is unavailable', async () => {
    const complete = vi.fn(async () => {});
    await expect(copyBrowserPaths(['/fixture/file'], complete, undefined)).rejects.toThrow(
      'clipboard',
    );
    expect(complete).not.toHaveBeenCalled();
  });
});
