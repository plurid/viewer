// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createElement, useRef } from 'react';
import type { FileEntry } from '../src/domain/contracts';
import {
  rowsUnder,
  tilesUnder,
  useMarquee,
  type MarqueeSelect,
} from '../src/renderer/explorer/marquee';
import { FileSelection } from '../src/renderer/explorer/selection';

const entry = (name: string) => ({ path: '/fixtures/' + name, name }) as FileEntry;
const rows = Array.from({ length: 10 }, (_, index) => ({
  index,
  start: index * 30,
  end: (index + 1) * 30,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('marquee geometry', () => {
  it('finds rows crossed by a rectangle, including rows outside the rendered window', () => {
    expect(rowsUnder(rows, { left: 0, top: 35, right: 10, bottom: 95 })).toEqual([1, 2, 3]);
    expect(rowsUnder(rows, { left: 0, top: 290, right: 10, bottom: 400 })).toEqual([9]);
    expect(rowsUnder(rows, { left: 0, top: 30, right: 10, bottom: 30 })).toEqual([]);
  });
  it('finds grid tiles by column and row, never past the last entry', () => {
    // Four columns of 100 units; 37 entries leave row 9 with one tile.
    expect(tilesUnder(rows, { left: 150, top: 10, right: 250, bottom: 40 }, 4, 400, 37)).toEqual([
      1, 2, 5, 6,
    ]);
    expect(tilesUnder(rows, { left: 0, top: 280, right: 400, bottom: 300 }, 4, 400, 37)).toEqual([
      36,
    ]);
    expect(tilesUnder(rows, { left: 410, top: 0, right: 500, bottom: 300 }, 4, 400, 37)).toEqual(
      [],
    );
  });
});

describe('marquee selection', () => {
  it('replaces the selection, or adds to the selection held when the drag began', () => {
    const session = { selection: ['/fixtures/a'], anchor: '', cursor: '', cache: new Map() };
    const commits: string[][] = [];
    const selection = new FileSelection(session, (paths) => {
      session.selection = paths;
      commits.push(paths);
    });
    selection.region([entry('b'), entry('c')]);
    expect(commits.at(-1)).toEqual(['/fixtures/b', '/fixtures/c']);
    expect(session.anchor).toBe('/fixtures/b');
    expect(session.cursor).toBe('/fixtures/c');
    selection.region([entry('c')], ['/fixtures/a']);
    expect(commits.at(-1)).toEqual(['/fixtures/a', '/fixtures/c']);
    selection.region([], []);
    expect(commits.at(-1)).toEqual([]);
  });
  it('selects by dragging over blank space and keeps the selection through the ending click', () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 0),
    );
    const select = vi.fn<MarqueeSelect>();
    const cleared = vi.fn();
    const entries = Array.from({ length: 10 }, (_, index) => entry('file-' + index));
    function View() {
      const scroll = useRef<HTMLDivElement>(null);
      const content = useRef<HTMLDivElement>(null);
      const marquee = useMarquee(
        scroll,
        content,
        (rect) => rowsUnder(rows, rect).map((index) => entries[index]),
        select,
        ['/fixtures/kept'],
      );
      return createElement(
        'div',
        { className: 'folder-content', onClick: cleared },
        createElement(
          'div',
          {
            ref: scroll,
            className: 'file-scroll',
            'data-testid': 'scroll',
            onPointerDown: marquee.onPointerDown,
          },
          createElement('div', { ref: content }, marquee.overlay),
        ),
      );
    }
    const { getByTestId, container } = render(createElement(View));
    const scroll = getByTestId('scroll');
    Object.defineProperty(scroll, 'clientWidth', { value: 400 });
    Object.defineProperty(scroll, 'clientHeight', { value: 300 });
    const pointer = (type: string, x: number, y: number, shiftKey = false) =>
      fireEvent(
        type === 'pointerdown' ? scroll : window,
        Object.assign(
          new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, shiftKey }),
          { pointerId: 1 },
        ),
      );
    // A press without movement is an ordinary click.
    pointer('pointerdown', 10, 10);
    pointer('pointerup', 11, 11);
    expect(select).not.toHaveBeenCalled();
    pointer('pointerdown', 10, 40, true);
    pointer('pointermove', 60, 100);
    return act(() => new Promise((resolve) => setTimeout(resolve, 5))).then(() => {
      expect(container.querySelector('.file-marquee')).not.toBeNull();
      expect(select).toHaveBeenLastCalledWith(
        [entries[1], entries[2], entries[3]],
        ['/fixtures/kept'],
      );
      pointer('pointerup', 60, 100);
      fireEvent.click(scroll);
      expect(cleared).not.toHaveBeenCalled();
      expect(container.querySelector('.file-marquee')).toBeNull();
      fireEvent.click(scroll);
      expect(cleared).toHaveBeenCalledTimes(1);
    });
  });
});
