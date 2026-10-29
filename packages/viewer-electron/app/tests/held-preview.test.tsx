// @vitest-environment jsdom
/**
 * Moving between files remounted the preview and showed an empty frame, then a spinner, before
 * the next file's content: Columns flickered on every step. The shown preview now stays until the
 * next one has content.
 */
import { act, cleanup, render } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

const ready = new Set<string>();
const listeners = new Set<() => void>();
const show = (path: string) => {
  ready.add(path);
  for (const listener of listeners) listener();
};
vi.mock('../src/renderer/previews/PreviewHost', () => ({
  PreviewHost: ({ path }: { path: string }) => {
    const shown = useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => ready.has(path),
    );
    return (
      <div data-path={path}>
        {shown ? `The contents of ${path} are on screen.` : <div className="loading">Opening</div>}
      </div>
    );
  },
}));
const { HeldPreview } = await import('../src/renderer/previews/HeldPreview');

const layers = (container: HTMLElement) =>
  [...container.querySelectorAll('.held-preview-layer')].map((layer) => ({
    path: layer.querySelector('[data-path]')?.getAttribute('data-path'),
    waiting: layer.classList.contains('held-preview-waiting'),
  }));
const frames = () => act(async () => new Promise((resolve) => setTimeout(resolve, 50)));

afterEach(() => {
  cleanup();
  ready.clear();
});

it('keeps the shown file until the next one has content, then shows only the next', async () => {
  show('/a.pdf');
  const view = render(<HeldPreview path="/a.pdf" />);
  expect(layers(view.container)).toEqual([{ path: '/a.pdf', waiting: false }]);
  view.rerender(<HeldPreview path="/b.epub" />);
  await frames();
  expect(layers(view.container)).toEqual([
    { path: '/a.pdf', waiting: false },
    { path: '/b.epub', waiting: true },
  ]);
  act(() => show('/b.epub'));
  await frames();
  expect(layers(view.container)).toEqual([{ path: '/b.epub', waiting: false }]);
});

it('drops a file passed over on the way, keeping the one on screen', async () => {
  show('/a.pdf');
  const view = render(<HeldPreview path="/a.pdf" />);
  view.rerender(<HeldPreview path="/b.epub" />);
  view.rerender(<HeldPreview path="/c.xlsx" />);
  await frames();
  expect(layers(view.container)).toEqual([
    { path: '/a.pdf', waiting: false },
    { path: '/c.xlsx', waiting: true },
  ]);
});

it('shows the next file with its own progress when it takes longer than a second', async () => {
  show('/a.pdf');
  const view = render(<HeldPreview path="/a.pdf" />);
  view.rerender(<HeldPreview path="/slow.docx" />);
  await act(async () => new Promise((resolve) => setTimeout(resolve, 1150)));
  expect(layers(view.container)).toEqual([{ path: '/slow.docx', waiting: false }]);
});
