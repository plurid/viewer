import { describe, expect, it, vi } from 'vitest';
import { AppIcons } from '../src/desktop/app-icons';
import { isApplication } from '../src/renderer/explorer/app-icon';

describe('application icons', () => {
  it('render once per bundle, size and version, sharing concurrent requests', async () => {
    const render = vi.fn(async (file: string, size: string) => `data:${size}:${file}`);
    const icons = new AppIcons(render, 2);
    const [a, b] = await Promise.all([
      icons.get('/Applications/Mail.app', 'small', 1),
      icons.get('/Applications/Mail.app', 'small', 1),
    ]);
    expect(a).toBe('data:small:/Applications/Mail.app');
    expect(b).toBe(a);
    expect(render).toHaveBeenCalledTimes(1);
    // An updated app (new modification time) is rendered again.
    await icons.get('/Applications/Mail.app', 'small', 2);
    expect(render).toHaveBeenCalledTimes(2);
    // The oldest entry is evicted beyond the limit.
    await icons.get('/Applications/Notes.app', 'large', 1);
    await icons.get('/Applications/Mail.app', 'small', 1);
    expect(render).toHaveBeenCalledTimes(4);
  });
  it('does not cache failures', async () => {
    const render = vi.fn().mockRejectedValueOnce(new Error('no icon')).mockResolvedValue('data:x');
    const icons = new AppIcons(render);
    await expect(icons.get('/Applications/X.app', 'small', 1)).rejects.toThrow('no icon');
    await expect(icons.get('/Applications/X.app', 'small', 1)).resolves.toBe('data:x');
  });
  it('treats only .app folders as applications', () => {
    expect(isApplication({ directory: true, extension: 'app' })).toBe(true);
    expect(isApplication({ directory: false, extension: 'app' })).toBe(false);
    expect(isApplication({ directory: true, extension: '' })).toBe(false);
  });
});
