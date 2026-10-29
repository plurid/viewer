import { describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  thumbnail: vi.fn(),
  processor: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/viewer' },
  nativeImage: { createThumbnailFromPath: native.thumbnail },
}));
vi.mock('../src/desktop/transforms/process', () => ({ runProcessor: native.processor }));
import { AppIcons } from '../src/desktop/native/app-icons';
import { nativeAppIcon } from '../src/desktop/native/native-app-icon';
import { hasBundleIcon } from '../src/renderer/explorer/app-icon';
import { isPackage } from '../src/domain/files/entries';
import { setAssetRoot } from '../src/desktop/native/assets';

// as main.ts does at startup, for a development build
setAssetRoot(false, '/viewer');

describe('application icons', () => {
  it('cancels the active helper and never starts queued icon decoders during shutdown', async () => {
    let active: AbortSignal | undefined;
    const render = vi.fn(async (_file: string, _size: string, signal: AbortSignal) => {
      active = signal;
      return new Promise<string>((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      );
    });
    const icons = new AppIcons(render);
    const first = icons.get('/fixture/A.app', 'small', 1);
    const second = icons.get('/fixture/B.app', 'small', 1);
    const settled = Promise.allSettled([first, second]);
    await vi.waitFor(() => expect(active).toBeDefined());
    await icons.close();
    expect(active!.aborted).toBe(true);
    expect(render).toHaveBeenCalledOnce();
    expect((await settled).every((result) => result.status === 'rejected')).toBe(true);
  });
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
  it('renders correctly sized bundle icons in the private helper without Quick Look fallback', async () => {
    const png = (size: number) => {
      const data = Buffer.alloc(24);
      Buffer.from('89504e470d0a1a0a', 'hex').copy(data);
      data.writeUInt32BE(size, 16);
      data.writeUInt32BE(size, 20);
      return data;
    };
    for (const [size, pixels] of [
      ['small', 64],
      ['large', 256],
    ] as const) {
      native.processor.mockResolvedValueOnce(png(pixels));
      expect(await nativeAppIcon('/Applications/Claude.app', size)).toBe(
        'data:image/png;base64,' + png(pixels).toString('base64'),
      );
      expect(native.processor).toHaveBeenLastCalledWith(
        '/viewer/assets/viewer-image-preview',
        ['icon', String(pixels)],
        [],
        expect.any(AbortSignal),
        expect.objectContaining({
          timeout: 8000,
          input: Buffer.from(JSON.stringify('/Applications/Claude.app')),
        }),
      );
    }
    native.processor.mockRejectedValueOnce(new Error('Decoder unavailable'));
    await expect(nativeAppIcon('/Applications/Old.app', 'small')).rejects.toThrow('unavailable');
    expect(native.thumbnail).not.toHaveBeenCalled();
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
