import { describe, expect, it, vi } from 'vitest';
import {
  guardNativeTestRemovals,
  guardTestTrash,
  nativeTestRemovalsBlocked,
} from '../src/desktop/native/test-removal-policy';

const isolatedTest = {
  VIEWER_RENDER_TEST: '1',
  VIEWER_DATA_DIRECTORY: '/generated/isolated-profile',
  VIEWER_TEST_NO_REMOVAL: '1',
};

function recordingAdapter() {
  const trash = vi.fn(async (file: string, purpose?: string, expected?: object) => ({
    path: file,
    purpose,
    expected,
  }));
  const information = vi.fn(async function (this: unknown, file: string) {
    expect(this).toBe(native);
    return `Read ${file}`;
  });
  const native = { trash, information };
  for (const name of ['trash', 'information'] as const)
    Object.defineProperty(native, name, {
      value: native[name],
      writable: false,
      configurable: false,
      enumerable: false,
    });
  Object.freeze(native);
  return native;
}

describe('isolated native test removal policy', () => {
  it('rejects every native Trash signature before entering the recording adapter', async () => {
    const native = recordingAdapter();
    const guarded = guardNativeTestRemovals(native, isolatedTest);
    const expected = { version: { identity: '1:2' }, sha256: 'a'.repeat(64) };
    for (const attempt of [
      guarded.trash('/generated/one'),
      guarded.trash('/generated/two', 'test-purpose'),
      guarded.trash('/generated/three', undefined, expected),
    ])
      await expect(attempt).rejects.toMatchObject({ code: 'TEST_REMOVAL_BLOCKED' });
    expect(native.trash).not.toHaveBeenCalled();
    await expect(guarded.information('/generated/readable')).resolves.toBe(
      'Read /generated/readable',
    );
    expect(native.information).toHaveBeenCalledExactlyOnceWith('/generated/readable');
    expect(Object.keys(guarded)).toEqual(Object.keys(native));
    expect(Object.getOwnPropertyDescriptor(native, 'trash')?.configurable).toBe(false);
    expect(Object.getOwnPropertyDescriptor(guarded, 'trash')?.configurable).toBe(false);
  });

  it('blocks the Electron shell fallback before any operating-system call', async () => {
    const fallback = vi.fn(async (_file: string) => {});
    const guarded = guardTestTrash(fallback, isolatedTest);
    await expect(guarded('/generated/fallback')).rejects.toMatchObject({
      code: 'TEST_REMOVAL_BLOCKED',
    });
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { VIEWER_TEST_NO_REMOVAL: '1' },
    { VIEWER_RENDER_TEST: '1', VIEWER_TEST_NO_REMOVAL: '1' },
    { VIEWER_DATA_DIRECTORY: '/generated/profile', VIEWER_TEST_NO_REMOVAL: '1' },
    { ...isolatedTest, VIEWER_RENDER_TEST: '0' },
    { ...isolatedTest, VIEWER_TEST_NO_REMOVAL: '0' },
  ])('leaves the ordinary adapter unchanged outside guarded test mode: %j', async (environment) => {
    const native = recordingAdapter();
    expect(nativeTestRemovalsBlocked(environment)).toBe(false);
    expect(guardNativeTestRemovals(native, environment)).toBe(native);
    expect(guardTestTrash(native.trash, environment)).toBe(native.trash);
    const expected = { reviewed: true };
    await native.trash('/generated/recording-only', 'purpose', expected);
    expect(native.trash).toHaveBeenCalledExactlyOnceWith(
      '/generated/recording-only',
      'purpose',
      expected,
    );
  });

  it('does not release an already guarded adapter when its environment object changes', async () => {
    const native = recordingAdapter();
    const environment = { ...isolatedTest };
    const guarded = guardNativeTestRemovals(native, environment);
    environment.VIEWER_TEST_NO_REMOVAL = '0';
    await expect(guarded.trash('/generated/kept')).rejects.toMatchObject({
      code: 'TEST_REMOVAL_BLOCKED',
    });
    expect(native.trash).not.toHaveBeenCalled();
  });
});
