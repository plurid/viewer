// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePreviewScroll } from '../src/renderer/previews/scroll';
import type { PreviewContext } from '../src/renderer/previews/contracts';

let resize: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Scroll({
  state,
  section = 'chapter-1',
  ready = true,
}: {
  state: PreviewContext['state'];
  section?: string;
  ready?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  usePreviewScroll(state, ref, 'epub', { ready, section });
  return (
    <div ref={ref} data-testid="scroll">
      <div>Generated chapter</div>
    </div>
  );
}
const store = () => {
  const values = new Map<string, unknown>([
    ['scroll.epub', { section: 'chapter-1', top: 420, left: 16 }],
  ]);
  return {
    values,
    state: {
      get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => {
        values.set(key, value);
      },
    },
  };
};

it('restores only after content is ready and flushes the exact offset before close', () => {
  const { values, state } = store();
  const view = render(<Scroll state={state} ready={false} />);
  const element = view.getByTestId('scroll');
  expect(element.scrollTop).toBe(0);
  view.rerender(<Scroll state={state} />);
  expect(element.scrollTop).toBe(420);
  element.scrollTop = 541.5;
  element.scrollLeft = 28;
  act(() => {
    element.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('viewer-preview-flush'));
  });
  expect(values.get('scroll.epub')).toEqual({ section: 'chapter-1', top: 541.5, left: 28 });
  view.unmount();
  expect(values.get('scroll.epub')).toEqual({ section: 'chapter-1', top: 541.5, left: 28 });
});

it('starts a new section at the top and does not restore over subsequent user navigation', () => {
  const { state } = store();
  const view = render(<Scroll state={state} />);
  const element = view.getByTestId('scroll');
  element.scrollTop = 700;
  act(() => {
    element.dispatchEvent(new Event('wheel'));
    resize();
    vi.advanceTimersByTime(600);
  });
  expect(element.scrollTop).toBe(700);
  view.rerender(<Scroll state={state} section="chapter-2" />);
  expect(element.scrollTop).toBe(0);
  expect(element.scrollLeft).toBe(0);
});
