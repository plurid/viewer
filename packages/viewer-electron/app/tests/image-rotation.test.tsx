// @vitest-environment jsdom
/**
 * A PICTURE'S VIEW TURNS, THE PICTURE DOES NOT: Rotate left and right, ⌘L and ⌘R, and two fingers
 * on the trackpad turn the view by quarters, remembered with the file's view and fitted to the
 * stage; Save rotated copy writes a new file beside it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DesktopEvent, FileEntry } from '../src/domain/contracts';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import ImagePreview from '../src/renderer/previews/modules/ImagePreview';
import { previewOwnsKey } from '../src/renderer/previews/keys';
import {
  gestureSettle,
  nearestTurn,
  normalAngle,
  rotatedCopyRequest,
  turnPoint,
  turnedFit,
} from '../src/renderer/previews/rotation';
import { PreviewFrameFixture } from './support/preview-frame';

describe('turning a view', () => {
  it('settles on the nearest quarter, 0 up to 360', () => {
    expect(normalAngle(-90)).toBe(270);
    expect(normalAngle(450)).toBe(90);
    expect(nearestTurn(50)).toBe(90);
    expect(nearestTurn(-40)).toBe(0);
    expect(nearestTurn(-50)).toBe(270);
  });
  it('fits a turned picture whole, never larger than its own pixels', () => {
    // 2400 × 900, laid out 560 × 210 in a 560 × 360 stage
    const shown = { width: 560, height: 210 };
    const natural = { width: 2400, height: 900 };
    const room = { width: 560, height: 360 };
    expect(turnedFit(shown, natural, room, 0)).toBe(1);
    expect(turnedFit(shown, natural, room, 180)).toBeCloseTo(1);
    // on its side it is 360 tall: 560 → 360
    expect(turnedFit(shown, natural, room, 90)).toBeCloseTo(360 / 560);
    // a small picture turned stays at its own size
    const small = { width: 100, height: 50 };
    expect(turnedFit(small, small, room, 90)).toBe(1);
  });
  it('turns an offset with the picture', () => {
    expect(turnPoint({ x: 10, y: 0 }, 90)).toEqual({ x: 0, y: 10 });
    expect(turnPoint({ x: 10, y: 5 }, 180)).toEqual({ x: -10, y: -5 });
  });
});

const entry = (name: string, extension: string): FileEntry => ({
  path: `/fixtures/${name}`,
  parent: '/fixtures',
  name,
  extension,
  mime: 'image/png',
  kind: 'file',
  directory: false,
  size: 2_100_000,
  created: 1,
  modified: 2,
  hidden: false,
  identity: name,
});

describe('a rotated copy', () => {
  it('is a new file beside the picture, in its format, turned as the view is', () => {
    const request = rotatedCopyRequest(entry('Photo.JPG', 'JPG'), 270);
    expect(request).toMatchObject({
      kind: 'convert',
      sources: ['/fixtures/Photo.JPG'],
      destination: '/fixtures',
      name: 'Photo rotated.JPG',
      transform: { kind: 'image', format: 'jpeg', rotate: 270, quality: 92 },
    });
    expect(request.expectedSources?.[0]?.path).toBe('/fixtures/Photo.JPG');
    expect(rotatedCopyRequest(entry('Shot.webp', 'webp'), 90).name).toBe('Shot rotated.webp');
    // a format the processor reads but does not write becomes PNG
    expect(rotatedCopyRequest(entry('Scan.tiff', 'tiff'), 180)).toMatchObject({
      name: 'Scan rotated.png',
      transform: { format: 'png', rotate: 180 },
    });
  });
});

describe('the picture preview', () => {
  let listeners: ((event: DesktopEvent) => void)[] = [];
  const send = (rotation: number) =>
    act(() => {
      for (const listener of listeners) listener({ type: 'rotate-gesture', rotation });
    });
  beforeEach(() => {
    listeners = [];
    Object.assign(window, {
      viewer: {
        onEvent: (listener: (event: DesktopEvent) => void) => {
          listeners.push(listener);
          return () => {
            listeners = listeners.filter((item) => item !== listener);
          };
        },
      },
    });
    HTMLElement.prototype.setPointerCapture = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
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

  /** A view's remembered values, as the preview store keeps them for a file. */
  const store = () => {
    const values = new Map<string, unknown>();
    return {
      values,
      state: { get: (key: string) => values.get(key), set: values.set.bind(values) },
    };
  };
  const context = (state: PreviewContext['state'], rotatedCopy = vi.fn()): PreviewContext =>
    ({
      resource: { id: 'picture', url: 'viewer-resource://picture', entry: entry('a.png', 'png') },
      active: true,
      interactive: true,
      look: 'dark',
      signal: new AbortController().signal,
      state,
      rotatedCopy,
      services: { thumbnail: vi.fn() },
    }) as unknown as PreviewContext;
  const show = (value: PreviewContext) =>
    render(
      <PreviewFrameFixture>
        <ImagePreview {...value} />
      </PreviewFrameFixture>,
    );
  const turn = (view: ReturnType<typeof render>) =>
    Number(view.container.querySelector<HTMLElement>('.image-stage')!.dataset.turn);
  const picture = (view: ReturnType<typeof render>) => view.container.querySelector('img')!;

  it('turns the view from its toolbar, remembers it and offers a rotated copy', () => {
    const { values, state } = store();
    const rotatedCopy = vi.fn();
    const view = show(context(state, rotatedCopy));
    expect(screen.queryByRole('button', { name: 'Save rotated copy' })).toBeNull();
    // the two stay together as one toolbar item
    const right = screen.getByRole('button', { name: 'Rotate right' });
    expect(right.closest('[data-header-item]')).toBe(
      screen.getByRole('button', { name: 'Rotate left' }).closest('[data-header-item]'),
    );
    expect(right.getAttribute('title')).toBe('Rotate right (⌘R)');
    fireEvent.click(right);
    expect(turn(view)).toBe(90);
    expect(picture(view).style.transform).toContain('rotate(90deg)');
    expect(values.get('image.turn')).toBe(90);
    fireEvent.click(screen.getByRole('button', { name: 'Save rotated copy' }));
    expect(rotatedCopy).toHaveBeenCalledWith(90);
    // left from 0 is 270, the short way round
    fireEvent.click(screen.getByRole('button', { name: 'Rotate left' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rotate left' }));
    expect(turn(view)).toBe(270);
    expect(picture(view).style.transform).toContain('rotate(-90deg)');
    view.unmount();
    // the file's view, shown again, is still turned
    const again = show(context(state));
    expect(turn(again)).toBe(270);
  });

  it('takes ⌘L and ⌘R once clicked, before the window does, leaving the focus where it was', () => {
    const view = show(context(store().state));
    const stage = view.container.querySelector<HTMLElement>('.image-stage')!;
    const outside = document.body.appendChild(document.createElement('button'));
    const key = (name: string, target: Element = document.body) => {
      const event = new KeyboardEvent('keydown', {
        key: name,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        target.dispatchEvent(event);
      });
      return event;
    };
    // nothing pressed yet: ⌘L is the window's Go to folder
    const before = new KeyboardEvent('keydown', { key: 'l', metaKey: true });
    Object.defineProperty(before, 'target', { value: document.body });
    expect(previewOwnsKey(before)).toBe(false);
    // a click on the picture moves no focus, so a list's arrows keep working after it
    fireEvent.pointerDown(stage);
    expect(document.activeElement).toBe(document.body);
    const owned = new KeyboardEvent('keydown', { key: 'r', metaKey: true });
    Object.defineProperty(owned, 'target', { value: document.body });
    expect(previewOwnsKey(owned)).toBe(true);
    expect(key('r').defaultPrevented).toBe(true);
    expect(turn(view)).toBe(90);
    key('l');
    key('l');
    expect(turn(view)).toBe(270);
    // the focus moved to something else: the keys are its own again
    outside.focus();
    expect(key('r', outside).defaultPrevented).toBe(false);
    expect(turn(view)).toBe(270);
    outside.remove();
  });

  it('follows two fingers on the trackpad and settles on the nearest quarter', () => {
    vi.useFakeTimers();
    const view = show(context(store().state));
    const stage = view.container.querySelector<HTMLElement>('.image-stage')!;
    fireEvent.pointerEnter(stage);
    // the desktop reports counterclockwise degrees: these turn it clockwise
    send(-30);
    send(-40);
    expect(picture(view).style.transform).toContain('rotate(70deg)');
    expect(turn(view)).toBe(0);
    send(0);
    act(() => vi.advanceTimersByTime(gestureSettle));
    expect(turn(view)).toBe(90);
    expect(picture(view).style.transform).toContain('rotate(90deg)');
    // a small turn falls back
    send(20);
    act(() => vi.advanceTimersByTime(gestureSettle));
    expect(turn(view)).toBe(90);
  });

  it('turns only the picture under the pointer when there are two', () => {
    vi.useFakeTimers();
    const first = show(context(store().state));
    const second = show(context(store().state));
    fireEvent.pointerEnter(second.container.querySelector('.image-stage')!);
    send(-90);
    act(() => vi.advanceTimersByTime(gestureSettle));
    expect(turn(first)).toBe(0);
    expect(turn(second)).toBe(90);
  });
});
