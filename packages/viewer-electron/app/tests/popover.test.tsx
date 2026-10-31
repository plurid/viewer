// @vitest-environment jsdom
/**
 * AN ANCHORED LAYER: placed from its anchor's box, which already includes a plane's transforms,
 * under it or above it when the window ends first, and always 8 px inside the window; an outside
 * press or Escape closes it, a press on its anchor does not, and focus goes back to the anchor. In
 * an open dialog it renders in that dialog's top layer.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { anchoredPosition, layerContainer, Popover } from '../src/renderer/ui/Popover';

const view = { width: 800, height: 600 };
const size = { width: 300, height: 200 };
const box = (left: number, top: number, width = 100, height = 30) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

describe('anchoredPosition', () => {
  it('lines up with the end of its anchor, 4 px under it', () => {
    expect(anchoredPosition(size, box(400, 50), view, 'end')).toEqual({ left: 200, top: 84 });
    expect(anchoredPosition(size, box(400, 50), view, 'start')).toEqual({ left: 400, top: 84 });
  });
  it('opens above its anchor when the window ends first', () => {
    expect(anchoredPosition(size, box(400, 500), view).top).toBe(500 - 4 - 200);
  });
  it('stays 8 px inside the window on every side', () => {
    expect(anchoredPosition(size, box(0, 50, 40), view, 'end').left).toBe(8);
    expect(anchoredPosition(size, box(700, 50), view, 'start').left).toBe(800 - 300 - 8);
    // no room above either: from the top edge
    expect(anchoredPosition({ width: 300, height: 590 }, box(400, 300), view).top).toBe(8);
    expect(anchoredPosition(size, { x: 790, y: 590 }, view)).toEqual({ left: 492, top: 392 });
    expect(anchoredPosition(size, { x: -20, y: -20 }, view)).toEqual({ left: 8, top: 8 });
  });
});

describe('Popover', () => {
  afterEach(cleanup);
  let measure: typeof HTMLElement.prototype.getBoundingClientRect;
  beforeEach(() => {
    measure = HTMLElement.prototype.getBoundingClientRect;
    // jsdom lays nothing out: the anchor at the window's right edge, the popover 300 × 200
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.classList.contains('popover'))
        return { left: 0, top: 0, right: 300, bottom: 200, width: 300, height: 200 } as DOMRect;
      if (this.dataset.anchor)
        return { left: 980, top: 10, right: 1020, bottom: 40, width: 40, height: 30 } as DOMRect;
      return measure.call(this);
    };
    return () => {
      HTMLElement.prototype.getBoundingClientRect = measure;
    };
  });

  function Opener({ onClose = () => {} }: { onClose?(): void }) {
    const anchor = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    return (
      <>
        <button ref={anchor} data-anchor="true" onClick={() => setOpen((value) => !value)}>
          Details
        </button>
        <button>Elsewhere</button>
        {open && anchor.current && (
          <Popover
            label="Details"
            anchor={anchor.current}
            onClose={() => {
              setOpen(false);
              onClose();
            }}
          >
            <input aria-label="Name" autoFocus />
          </Popover>
        )}
      </>
    );
  }
  const open = () => {
    const anchor = screen.getByRole('button', { name: 'Details' });
    anchor.focus();
    fireEvent.click(anchor);
    return { anchor, layer: screen.getByRole('dialog', { name: 'Details' }) };
  };

  it('is placed from its anchor, inside the window', () => {
    vi.stubGlobal('innerWidth', 1024);
    vi.stubGlobal('innerHeight', 768);
    render(<Opener />);
    const { layer } = open();
    const popover = layer.querySelector<HTMLElement>('.popover')!;
    // its end at the anchor's end, 1020 - 300, then 8 px inside: 1024 - 300 - 8 = 716
    expect(popover.style.left).toBe('716px');
    expect(popover.style.top).toBe('44px');
    vi.unstubAllGlobals();
  });

  it('closes on a press outside, not on its anchor or inside, and focus goes back', () => {
    const onClose = vi.fn();
    render(<Opener onClose={onClose} />);
    const { anchor, layer } = open();
    fireEvent.pointerDown(layer.querySelector('input')!);
    fireEvent.pointerDown(anchor);
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      screen.getByRole('textbox', { name: 'Name' }).focus();
    });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(anchor);
  });

  it('closes on Escape, unless what is inside took it first', () => {
    const onClose = vi.fn();
    render(<Opener onClose={onClose} />);
    const { anchor, layer } = open();
    const input = layer.querySelector('input')!;
    input.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(anchor);
  });

  it('renders in the open dialog its anchor is in, else the page', () => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    const inside = document.createElement('button');
    dialog.append(inside);
    document.body.append(dialog);
    expect(layerContainer(inside)).toBe(dialog);
    expect(layerContainer(document.createElement('button'))).toBe(document.body);
    expect(layerContainer(undefined)).toBe(document.body);
    dialog.remove();
  });
});
