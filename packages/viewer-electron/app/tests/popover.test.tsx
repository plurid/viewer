// @vitest-environment jsdom
import type { DesktopEvent } from '../src/domain/contracts';
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
  it('covers the top edge of its anchor when only the side above has some room', () => {
    // 38 px above, none below: it takes about three rows, over the anchor's top edge
    expect(anchoredPosition(size, { left: 400, right: 500, top: 50, bottom: 590 }, view)).toEqual({
      left: 200,
      top: 8,
      maxHeight: 3 * 34 + 10,
      side: 'above',
    });
  });
  it('counts a search field on top of the three rows it keeps', () => {
    const anchor = { left: 100, right: 200, top: 2, bottom: 598 };
    expect(anchoredPosition(size, anchor, view, 'end', 3 * 34 + 10 + 41).maxHeight).toBe(153);
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
  let anchorBox: DOMRect;
  beforeEach(() => {
    measure = HTMLElement.prototype.getBoundingClientRect;
    anchorBox = new DOMRect(980, 10, 40, 30);
    // jsdom lays nothing out: the anchor at the window's right edge, the popover 300 × 200
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.classList.contains('popover'))
        return { left: 0, top: 0, right: 300, bottom: 200, width: 300, height: 200 } as DOMRect;
      if (this.dataset.anchor) return anchorBox;
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

  it('leaves the keyboard alone when the plane that held its anchor closes', async () => {
    // the layer lives outside the plane, so it closes only after the plane, and its anchor, are gone
    function Host() {
      const anchor = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(false);
      const [plane, setPlane] = useState(true);
      return (
        <div>
          <button>Outside</button>
          <button hidden onClick={() => setPlane(false)}>
            Close plane
          </button>
          {plane && (
            <div data-plurid-entity="PluridPlane">
              <button ref={anchor} onClick={() => setOpen((value) => !value)}>
                Details
              </button>
            </div>
          )}
          {open && anchor.current && (
            <Popover label="Details" anchor={anchor.current} onClose={() => setOpen(false)}>
              <input aria-label="Name" autoFocus />
            </Popover>
          )}
        </div>
      );
    }
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    act(() => {
      screen.getByText('Close plane').click();
    });
    // it sees its anchor gone at the next frame
    await nextFrame();

    expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull();
    // what closed the plane decides where the keyboard goes; the menu takes nothing on the page
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Outside' }));
  });

  it('takes a press on a label whose control is its anchor as a press on the anchor', () => {
    render(<Opener inLabel />);
    // its label names it: “Shown details Details”
    const anchor = screen.getByText('Details', { selector: 'button' });
    act(() => anchor.focus());
    fireEvent.click(anchor);
    const text = screen.getByText('Shown details');
    // the press does not close it; the label hands its click to the anchor, whose toggle does
    fireEvent.pointerDown(text);
    expect(screen.queryByRole('dialog', { name: 'Details' })).not.toBeNull();
    fireEvent.click(text);
    expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull();
    expect(document.activeElement).toBe(anchor);
  });

  /** A press as the browser delivers it: down, up and a click counting one, in one task. */
  const press = (element: HTMLElement) => {
    const proceeds = fireEvent.pointerDown(element);
    fireEvent.pointerUp(element);
    fireEvent.click(element, { detail: 1 });
    return proceeds;
  };
  /** What runs after the press's task: its pointerup's timer among it. */
  const nextTask = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

  it('only closes on a press outside: the click that ends that press reaches nothing', async () => {
    const onElsewhere = vi.fn();
    render(<Opener onElsewhere={onElsewhere} />);
    open();
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    expect(press(elsewhere)).toBe(false);
    expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull();
    expect(onElsewhere).not.toHaveBeenCalled();
    // the next press is an ordinary one
    await nextTask();
    press(elsewhere);
    expect(onElsewhere).toHaveBeenCalledTimes(1);
  });

  it('swallows one click only, and none from the keyboard', () => {
    const onElsewhere = vi.fn();
    render(<Opener onElsewhere={onElsewhere} />);
    open();
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    // the press's release went elsewhere, a window or a scrollbar taking it
    fireEvent.pointerDown(elsewhere);
    // Space or Enter on a focused button: a click counting no presses
    fireEvent.click(elsewhere, { detail: 0 });
    expect(onElsewhere).toHaveBeenCalledTimes(1);
    fireEvent.click(elsewhere, { detail: 1 });
    expect(onElsewhere).toHaveBeenCalledTimes(1);
    fireEvent.click(elsewhere, { detail: 1 });
    expect(onElsewhere).toHaveBeenCalledTimes(2);
  });

  it('leaves no listener on the window once the press it swallowed is over', () => {
    const listening: [string, EventListenerOrEventListenerObject][] = [];
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation(function (type, listener, options) {
      if (options === true && listener) listening.push([type, listener]);
      add(type, listener, options);
    });
    vi.spyOn(window, 'removeEventListener').mockImplementation(function (type, listener, options) {
      const at = listening.findIndex(([kind, held]) => kind === type && held === listener);
      if (options === true && at >= 0) listening.splice(at, 1);
      remove(type, listener, options);
    });
    try {
      render(<Opener />);
      open();
      press(screen.getByRole('button', { name: 'Elsewhere' }));
      expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull();
      expect(listening).toEqual([]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('swallows only the click of what that press landed on', () => {
    render(<Opener />);
    open();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull();
    // a click on its anchor, which that press did not land on, opens it again
    fireEvent.click(screen.getByRole('button', { name: 'Details' }), { detail: 1 });
    expect(screen.queryByRole('dialog', { name: 'Details' })).not.toBeNull();
  });

  it('swallows no later click when the press that closed it ended without one', async () => {
    const onElsewhere = vi.fn();
    render(<Opener onElsewhere={onElsewhere} />);
    open();
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    // pressed, then let go over the page: no click follows that press
    fireEvent.pointerDown(elsewhere);
    fireEvent.pointerUp(document.body);
    await nextTask();
    fireEvent.click(elsewhere, { detail: 1 });
    expect(onElsewhere).toHaveBeenCalledTimes(1);
    // nor when its release never came, once the next press begins
    open();
    fireEvent.pointerDown(elsewhere);
    fireEvent.pointerDown(elsewhere);
    fireEvent.click(elsewhere, { detail: 1 });
    expect(onElsewhere).toHaveBeenCalledTimes(2);
  });

  it('takes a right press outside as a press: it shows no context menu of its own', () => {
    const onContextMenu = vi.fn();
    render(<Opener />);
    open();
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    elsewhere.addEventListener('contextmenu', onContextMenu);
    fireEvent.pointerDown(elsewhere, { button: 2 });
    fireEvent.contextMenu(elsewhere);
    expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull();
    expect(onContextMenu).not.toHaveBeenCalled();
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

  it('closes when the window is dragged by its title bar', () => {
    const listeners = new Set<(event: DesktopEvent) => void>();
    const viewer = (window as unknown as { viewer?: unknown }).viewer;
    Object.assign(window, {
      viewer: {
        onEvent: (listener: (event: DesktopEvent) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    });
    try {
      render(<Opener />);
      open();
      act(() => {
        for (const listener of listeners) listener({ type: 'window-moved' });
      });
      expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull();
      expect(listeners.size).toBe(0);
    } finally {
      Object.assign(window, { viewer });
    }
  });

  it('closes when what holds its anchor scrolls, not when what is inside it scrolls', () => {
    render(<Opener />);
    const { layer } = open();
    fireEvent.scroll(layer.querySelector('.popover')!);
    expect(screen.queryByRole('dialog', { name: 'Details' })).not.toBeNull();
    fireEvent.scroll(document.querySelector('.holder')!);
    expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull();
  });

  it('moves with its anchor while the plane settles, as after Frame or Dock', async () => {
    render(<Opener inPlane />);
    const { layer } = open();
    const popover = layer.querySelector<HTMLElement>('.popover')!;
    expect(popover.style.top).toBe('44px');
    // the plane eases on after the press: its anchor moves 20 px down, then 6 more
    anchorBox = new DOMRect(980, 30, 40, 30);
    await nextFrame();
    expect(popover.style.top).toBe('64px');
    anchorBox = new DOMRect(980, 36, 40, 30);
    await nextFrame();
    expect(popover.style.top).toBe('70px');
    // near the window's bottom it goes above, held by its bottom
    anchorBox = new DOMRect(980, 700, 40, 30);
    await nextFrame();
    expect(popover.style.top).toBe('auto');
    expect(popover.style.bottom).not.toBe('');
    // back up and a few pixels sideways, it goes below again, its bottom let go
    anchorBox = new DOMRect(970, 36, 40, 30);
    await nextFrame();
    expect(popover.style.top).toBe('70px');
    expect(popover.style.bottom).toBe('');
    expect(popover.style.left).toBe('710px');
    // only sideways, as a plane slides along
    anchorBox = new DOMRect(960, 36, 40, 30);
    await nextFrame();
    expect(popover.style.left).toBe('700px');
    expect(screen.queryByRole('dialog', { name: 'Details' })).not.toBeNull();
  });

  it('closes on a wheel or pinch outside it, a pan or zoom of the space, not on its own', () => {
    render(<Opener inPlane />);
    const { layer } = open();
    fireEvent.wheel(layer.querySelector('.popover')!);
    expect(screen.queryByRole('dialog', { name: 'Details' })).not.toBeNull();
    fireEvent.wheel(screen.getByLabelText('Files'), { ctrlKey: true });
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

  it('gives the keyboard to a summary near a gone anchor, past a hidden or disabled control', () => {
    function Host() {
      const anchor = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(false);
      const [shown, setShown] = useState(true);
      return (
        <div>
          {shown && (
            <button ref={anchor} onClick={() => setOpen((value) => !value)}>
              Details
            </button>
          )}
          <button hidden onClick={() => setShown(false)}>
            Remove details
          </button>
          <button disabled>Unavailable</button>
          <details>
            <summary>More</summary>
          </details>
          {open && anchor.current && (
            <Popover label="Details" anchor={anchor.current} onClose={() => setOpen(false)}>
              <input aria-label="Name" autoFocus />
            </Popover>
          )}
        </div>
      );
    }
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    removeAnchor();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Escape' });
    expect(document.activeElement).toBe(screen.getByText('More'));
  });

  it('leaves the keyboard alone when only the page held its gone anchor', () => {
    // both straight on the page: what is left there is no place the anchor stood in
    const other = document.createElement('button');
    other.textContent = 'Other';
    const anchor = document.createElement('button');
    anchor.textContent = 'Details';
    document.body.append(other, anchor);
    try {
      render(
        <Popover label="Details" anchor={anchor} onClose={() => {}}>
          <input aria-label="Name" autoFocus />
        </Popover>,
      );
      anchor.remove();
      cleanup();
      expect(document.activeElement).not.toBe(other);
    } finally {
      other.remove();
    }
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
