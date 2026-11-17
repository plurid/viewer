// @vitest-environment jsdom
/**
 * AN ANCHORED LAYER: placed from its anchor's box, which already includes a plane's transforms,
 * under it or above it when the window ends first, never over it, and 8 px inside the window; an
 * outside press or Escape closes it, a press on its anchor does not, and focus goes back to the
 * anchor. In an open dialog it renders in that dialog's top layer.
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
    expect(anchoredPosition(size, box(400, 50), view, 'end')).toEqual({
      left: 200,
      top: 84,
      maxHeight: 508,
      side: 'below',
    });
    expect(anchoredPosition(size, box(400, 50), view, 'start')).toEqual({
      left: 400,
      top: 84,
      maxHeight: 508,
      side: 'below',
    });
  });
  it('places an element from its box: a DOMRect has x and y, but is not a pointer', () => {
    // Taken for a pointer, it put the layer on its anchor's top left corner, over the button.
    const anchor = new DOMRect(400, 50, 100, 30);
    const place = anchoredPosition(size, anchor, view, 'end');

    expect(place).toEqual({ left: 200, top: 84, maxHeight: 508, side: 'below' });
    expect(place.top).toBeGreaterThanOrEqual(anchor.bottom);
  });
  it('opens above its anchor when the window ends first', () => {
    expect(anchoredPosition(size, box(400, 500), view)).toEqual({
      left: 200,
      top: 500 - 4 - 200,
      maxHeight: 488,
      side: 'above',
    });
  });
  it('opens below when neither side fits and both have the same room', () => {
    // 600 - 8 - (315 + 4) = 273 below, 285 - 4 - 8 = 273 above
    expect(anchoredPosition({ width: 300, height: 400 }, box(400, 285), view)).toEqual({
      left: 200,
      top: 319,
      maxHeight: 273,
      side: 'below',
    });
  });
  it('keeps to the window when its anchor has scrolled out of it', () => {
    expect(anchoredPosition(size, box(400, -100), view).top).toBe(8);
    const under = anchoredPosition(size, box(400, 700), view);
    expect(under.top + size.height).toBe(600 - 8);
    expect(under.side).toBe('above');
  });
  it('covers its anchor only when neither side has room for about three rows', () => {
    const place = anchoredPosition(size, { left: 100, right: 200, top: 2, bottom: 598 }, view);

    expect(place.maxHeight).toBe(3 * 34 + 10);
    expect(place.top + place.maxHeight).toBe(600 - 8);
    // a shorter list keeps its whole height, covering only as much of the anchor as that takes
    expect(anchoredPosition({ width: 300, height: 60 }, box(400, 30, 100, 540), view)).toEqual({
      left: 200,
      top: 532,
      maxHeight: 60,
      side: 'below',
    });
  });
  it('stays 8 px inside the window on every side', () => {
    expect(anchoredPosition(size, box(0, 50, 40), view, 'end').left).toBe(8);
    expect(anchoredPosition(size, box(700, 50), view, 'start').left).toBe(800 - 300 - 8);
    // Neither side fits, so the taller upper side limits the height.
    expect(anchoredPosition({ width: 300, height: 590 }, box(400, 300), view).top).toBe(8);
    expect(anchoredPosition(size, { x: 790, y: 590 }, view)).toEqual({
      left: 492,
      top: 392,
      maxHeight: 200,
      side: 'below',
    });
    expect(anchoredPosition(size, { x: -20, y: -20 }, view)).toEqual({
      left: 8,
      top: 8,
      maxHeight: 584,
      side: 'below',
    });
  });
});

describe('Popover', () => {
  afterEach(cleanup);
  let measure: typeof HTMLElement.prototype.getBoundingClientRect;
  let planeBox: DOMRect;
  beforeEach(() => {
    measure = HTMLElement.prototype.getBoundingClientRect;
    planeBox = new DOMRect(100, 50, 600, 400);
    // jsdom lays nothing out: the anchor at the window's right edge, the popover 300 × 200
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.classList.contains('popover'))
        return { left: 0, top: 0, right: 300, bottom: 200, width: 300, height: 200 } as DOMRect;
      if (this.dataset.anchor)
        return { left: 980, top: 10, right: 1020, bottom: 40, width: 40, height: 30 } as DOMRect;
      if (this.dataset.pluridEntity === 'PluridPlane') return planeBox;
      return measure.call(this);
    };
    return () => {
      HTMLElement.prototype.getBoundingClientRect = measure;
    };
  });

  function Opener({
    onClose = () => {},
    onElsewhere,
    inLabel = false,
    inPlane = false,
  }: {
    onClose?(): void;
    onElsewhere?(): void;
    inLabel?: boolean;
    inPlane?: boolean;
  }) {
    const anchor = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const [shown, setShown] = useState(true);
    const button = shown && (
      <button ref={anchor} data-anchor="true" onClick={() => setOpen((value) => !value)}>
        Details
      </button>
    );
    const content = (
      <div className="holder">
        {inLabel ? (
          <label>
            <span>Shown details</span>
            {button}
          </label>
        ) : (
          button
        )}
        <button onClick={onElsewhere}>Elsewhere</button>
        <button hidden onClick={() => setShown(false)}>
          Remove details
        </button>
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
      </div>
    );
    return inPlane ? (
      <div data-plurid-entity="PluridPlane">
        {content}
        <div className="folder-explorer" tabIndex={0} aria-label="Files" />
      </div>
    ) : (
      content
    );
  }
  const removeAnchor = () =>
    act(() => {
      screen.getByText('Remove details').click();
    });
  const nextFrame = () =>
    act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

  it('takes a press on a label whose control is its anchor as a press on the anchor', () => {
    render(<Opener inLabel />);
    const { anchor } = open();
    const text = screen.getByText('Shown details');
    // the press does not close it; the label hands its click to the anchor, whose toggle does
    fireEvent.pointerDown(text);
    expect(screen.queryByRole('dialog', { name: 'Details' })).not.toBeNull();
    fireEvent.click(text);
    expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull();
    expect(document.activeElement).toBe(anchor);
  });

  it('only closes on a press outside: the click that ends that press reaches nothing', () => {
    const onElsewhere = vi.fn();
    render(<Opener onElsewhere={onElsewhere} />);
    open();
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    expect(fireEvent.pointerDown(elsewhere)).toBe(false);
    fireEvent.click(elsewhere);
    expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull();
    expect(onElsewhere).not.toHaveBeenCalled();
    // the next press is an ordinary one
    fireEvent.pointerDown(elsewhere);
    fireEvent.click(elsewhere);
    expect(onElsewhere).toHaveBeenCalledTimes(1);
  });

  it('closes when the window loses focus or is resized', () => {
    render(<Opener />);
    const { anchor, layer } = open();
    // an element's blur is not the window's
    fireEvent.blur(layer.querySelector('input')!);
    expect(screen.queryByRole('dialog', { name: 'Details' })).not.toBeNull();
    fireEvent.blur(window);
    expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull();
    expect(document.activeElement).toBe(anchor);
    open();
    fireEvent(window, new Event('resize'));
    expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull();
  });

  it('closes when what holds its anchor scrolls, not when what is inside it scrolls', () => {
    render(<Opener />);
    const { layer } = open();
    fireEvent.scroll(layer.querySelector('.popover')!);
    expect(screen.queryByRole('dialog', { name: 'Details' })).not.toBeNull();
    fireEvent.scroll(document.querySelector('.holder')!);
    expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull();
  });

  it('closes when the camera moves the plane its anchor is in', async () => {
    render(<Opener inPlane />);
    open();
    await nextFrame();
    expect(screen.queryByRole('dialog', { name: 'Details' })).not.toBeNull();
    planeBox = new DOMRect(140, 50, 600, 400);
    await nextFrame();
    expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull();
  });

  it('closes when its anchor is gone, giving the keyboard to the plane', async () => {
    render(<Opener inPlane />);
    open();
    removeAnchor();
    await nextFrame();
    expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText('Files'));
  });

  it('gives the keyboard to a control near a gone anchor, not to the page', () => {
    render(<Opener />);
    open();
    removeAnchor();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Elsewhere' }));
  });

  it('leaves focus where it is when a dialog it is not in opened meanwhile', () => {
    render(<Opener />);
    const { anchor, layer } = open();
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.append(dialog);
    try {
      fireEvent.keyDown(layer.querySelector('input')!, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull();
      expect(document.activeElement).not.toBe(anchor);
    } finally {
      dialog.remove();
    }
  });
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
