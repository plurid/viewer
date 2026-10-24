import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  captureWindowFrame,
  restoreWindowFrame,
  WindowState,
  type WindowFrame,
} from '../src/desktop/windows/window-state';
import { temporaryRoot, trashTemporary, trashFixtureEntry } from '../tools/temporary';

const primary = { id: 1, workArea: { x: 0, y: 25, width: 1920, height: 1000 } };
const ordinary: WindowFrame = {
  version: 1,
  bounds: { x: 180, y: 120, width: 1000, height: 700 },
  maximized: false,
  fullscreen: false,
  display: primary,
};
let directory: string;
beforeEach(async () => {
  directory = await temporaryRoot('viewer-window-state-');
});
afterEach(async () => {
  await trashTemporary(directory);
});

describe('native window placement', () => {
  it('preserves an ordinary frame and a Rectangle-sized frame on their monitor', () => {
    expect(restoreWindowFrame(ordinary, [primary], primary).bounds).toEqual(ordinary.bounds);
    expect(
      restoreWindowFrame({ ...ordinary, bounds: primary.workArea }, [primary], primary).bounds,
    ).toEqual(primary.workArea);
  });
  it('keeps a Rectangle-sized window filling the available area after resolution or Dock changes', () => {
    const changed = { id: primary.id, workArea: { x: 80, y: 30, width: 1360, height: 820 } };
    expect(
      restoreWindowFrame({ ...ordinary, bounds: primary.workArea }, [changed], changed).bounds,
    ).toEqual(changed.workArea);
  });
  it('retains the relative position when a monitor moves, including negative coordinates', () => {
    const left = { id: primary.id, workArea: { ...primary.workArea, x: -1920 } };
    const moved = restoreWindowFrame(ordinary, [left], left).bounds;
    expect(moved).toEqual({ ...ordinary.bounds, x: ordinary.bounds.x - 1920 });
    expect(
      restoreWindowFrame({ ...ordinary, display: left, bounds: moved }, [left], left).bounds,
    ).toEqual(moved);
  });
  it('centers the saved size on the primary monitor when the previous display is disconnected', () => {
    expect(
      restoreWindowFrame({ ...ordinary, display: { ...primary, id: 2 } }, [primary], primary)
        .bounds,
    ).toEqual({ x: 460, y: 175, width: 1000, height: 700 });
  });
  it('shrinks an off-screen window and its minimum size to fit a smaller available display', () => {
    const small = { id: primary.id, workArea: { x: 0, y: 30, width: 700, height: 500 } };
    const restored = restoreWindowFrame(ordinary, [small], small);
    expect(restored.bounds).toEqual(small.workArea);
    expect([restored.minWidth, restored.minHeight]).toEqual([700, 500]);
  });
  it('saves the normal frame for native maximize/fullscreen, ignoring minimized geometry', () => {
    const native = {
      isMinimized: () => false,
      isMaximized: () => true,
      isFullScreen: () => false,
      getBounds: () => primary.workArea,
      getNormalBounds: () => ordinary.bounds,
    };
    expect(captureWindowFrame(native, primary)).toEqual({ ...ordinary, maximized: true });
    const full = captureWindowFrame(
      { ...native, isMaximized: () => false, isFullScreen: () => true },
      primary,
    );
    expect(full).toEqual({ ...ordinary, fullscreen: true });
    expect(restoreWindowFrame(full, [primary], primary).fullscreen).toBe(true);
    expect(captureWindowFrame({ ...native, isMinimized: () => true }, primary)).toBeNull();
    expect(
      captureWindowFrame(
        { ...native, getNormalBounds: () => ({ ...ordinary.bounds, width: 0 }) },
        primary,
      ),
    ).toBeNull();
  });
  it('writes the last resize before debounce and restores it from a fresh instance', async () => {
    const file = path.join(directory, 'window-state-v1.json');
    const store = new WindowState(file);
    store.remember(ordinary);
    store.remember({ ...ordinary, bounds: primary.workArea });
    await store.flush();
    expect(JSON.parse(await readFile(file, 'utf8')).bounds).toEqual(primary.workArea);
    const restarted = new WindowState(file);
    await restarted.load();
    expect(restoreWindowFrame(restarted.value, [primary], primary).bounds).toEqual(
      primary.workArea,
    );
    expect(await readdir(directory)).toEqual(['window-state-v1.json']);
  });
  it('retries a failed write at close without requiring another resize', async () => {
    const parent = path.join(directory, 'unavailable');
    await writeFile(parent, 'blocks creation');
    const store = new WindowState(path.join(parent, 'window-state-v1.json'));
    store.remember(ordinary);
    await expect(store.flush()).rejects.toThrow();
    await trashFixtureEntry(parent);
    await mkdir(parent);
    await store.flush();
    expect(JSON.parse(await readFile(store.file, 'utf8'))).toEqual(ordinary);
  });
  it.each(['missing', 'malformed', 'oversized', 'invalid'])(
    'recovers safely from a %s state file',
    async (kind) => {
      const file = path.join(directory, 'window-state-v1.json');
      if (kind !== 'missing')
        await writeFile(
          file,
          kind === 'malformed'
            ? '{'
            : kind === 'oversized'
              ? ' '.repeat(100000)
              : JSON.stringify({ ...ordinary, bounds: { ...ordinary.bounds, width: -1 } }),
        );
      const store = new WindowState(file);
      await store.load();
      expect(store.value).toBeNull();
      const fallback = restoreWindowFrame(store.value, [primary], primary);
      expect(fallback.bounds).toEqual({ x: 240, y: 55, width: 1440, height: 940 });
      store.remember(ordinary);
      await store.flush();
      expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(ordinary);
    },
  );
});

describe('the Settings window’s placement (2026-10-20)', () => {
  // Its size and category were written into config.jsonc on every resize and category switch,
  // under any editor that had the file open; a window over 2000 × 1600 was never remembered.
  const settings = { width: 900, height: 640, minWidth: 760, minHeight: 540 };
  it('opens at its own default size, or the one it had, with its own minimum', () => {
    const fresh = restoreWindowFrame(null, [primary], primary, settings);
    expect([fresh.bounds.width, fresh.bounds.height]).toEqual([900, 640]);
    expect([fresh.minWidth, fresh.minHeight]).toEqual([760, 540]);
    const large = { ...ordinary, bounds: { ...ordinary.bounds, width: 1700, height: 900 } };
    expect(restoreWindowFrame(large, [primary], primary, settings).bounds).toEqual(large.bounds);
  });
  it('keeps the last category with the frame, across a later resize', async () => {
    const file = path.join(directory, 'settings-window-v1.json');
    const store = new WindowState(file);
    store.remember({ ...ordinary, category: 'agents' });
    store.remember(ordinary);
    await store.flush();
    const restarted = new WindowState(file);
    await restarted.load();
    expect(restarted.value?.category).toBe('agents');
  });
});
