// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import {
  installMatchMedia,
  installPointerEvents,
  renderPlurid,
} from '@plurid/plurid-react/testing';

const planes = [{ route: '/folders/:id', component: () => createElement('div', null, 'folder') }];
const paths = (rendered: Awaited<ReturnType<typeof renderPlurid>>) =>
  rendered.handle.tree.get().map((plane) => new URL(plane.route).pathname);
// Node's own `localStorage` hides jsdom's; the engine needs a working one.
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}
beforeEach(() => {
  installMatchMedia();
  installPointerEvents();
  vi.stubGlobal('localStorage', memoryStorage());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// plurid 0.0.0-40 warned “route(s) with no registered plane” once for each root added here,
// because its check read a tree one commit behind; 0.0.0-41 reads the live tree and is quiet.
describe('engine roots', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  it('adds a root Viewer lists to the engine tree', async () => {
    const rendered = await renderPlurid({ planes, view: ['/folders/a'] });
    await act(async () => {
      await rendered.rerender({ planes, view: ['/folders/a', '/folders/b'] });
    });
    expect(paths(rendered)).toEqual(['/folders/a', '/folders/b']);
    await rendered.unmount();
  });
  it('adds a root missing from a restored arrangement', async () => {
    const first = await renderPlurid({
      id: 'restore',
      planes,
      view: ['/folders/a'],
      useLocalStorage: true,
    } as never);
    await first.unmount();
    const second = await renderPlurid({
      id: 'restore',
      planes,
      view: ['/folders/a', '/folders/c'],
      useLocalStorage: true,
    } as never);
    await act(async () => {});
    expect(paths(second)).toEqual(['/folders/a', '/folders/c']);
    await second.unmount();
  });
});
