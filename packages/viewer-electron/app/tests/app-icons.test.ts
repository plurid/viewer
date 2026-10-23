import { describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  thumbnail: vi.fn(),
  fileIcon: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { getFileIcon: native.fileIcon },
  nativeImage: { createThumbnailFromPath: native.thumbnail },
}));
import { AppIcons } from '../src/desktop/app-icons';
import { nativeAppIcon } from '../src/desktop/native-app-icon';
import { hasBundleIcon } from '../src/renderer/explorer/app-icon';
import { isPackage } from '../src/domain/files';

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
  it('shows the icon of applications and other bundles, which Finder shows as files', () => {
    expect(hasBundleIcon({ directory: true, extension: 'app' })).toBe(true);
    for (const extension of ['prefPane', 'rtfd', 'pages', 'key', 'xcodeproj'])
      expect(isPackage({ directory: true, extension: extension.toLowerCase() }), extension).toBe(
        true,
      );
    expect(hasBundleIcon({ directory: false, extension: 'app' })).toBe(false);
    expect(hasBundleIcon({ directory: true, extension: '' })).toBe(false);
  });
  it("renders an app's own icon with Quick Look: the system's small icon was a blank placeholder", async () => {
    // 2026-10-23: `app.getFileIcon` gave every application the same generic square
    const image = (url: string) => ({ isEmpty: () => false, toDataURL: () => url });
    native.thumbnail.mockResolvedValue(image('data:thumbnail'));
    native.fileIcon.mockResolvedValue(image('data:generic'));
    expect(await nativeAppIcon('/Applications/Claude.app', 'small')).toBe('data:thumbnail');
    expect(native.thumbnail).toHaveBeenLastCalledWith('/Applications/Claude.app', {
      width: 64,
      height: 64,
    });
    await nativeAppIcon('/Applications/Claude.app', 'large');
    expect(native.thumbnail).toHaveBeenLastCalledWith('/Applications/Claude.app', {
      width: 256,
      height: 256,
    });
    // without a thumbnail, the system's icon is better than none
    native.thumbnail.mockRejectedValueOnce(new Error('no preview'));
    expect(await nativeAppIcon('/Applications/Old.app', 'small')).toBe('data:generic');
    expect(native.fileIcon).toHaveBeenLastCalledWith('/Applications/Old.app', { size: 'normal' });
  });
  it('forgets only the bundles that changed', async () => {
    const render = vi.fn(async (file: string) => `data:${file}`);
    const icons = new AppIcons(render);
    await icons.get('/Applications/Mail.app', 'small', 1);
    await icons.get('/Applications/Notes.app', 'small', 1);
    icons.forget('/Applications/Mail.app');
    await icons.get('/Applications/Mail.app', 'small', 1);
    await icons.get('/Applications/Notes.app', 'small', 1);
    expect(render).toHaveBeenCalledTimes(3);
  });
});
