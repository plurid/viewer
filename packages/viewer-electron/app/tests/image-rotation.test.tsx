// @vitest-environment jsdom
/**
 * A PICTURE'S VIEW TURNS, THE PICTURE DOES NOT: Rotate Left and Right turn the view by quarters,
 * remembered with the file's view and fitted to the stage; a turn adds or removes no toolbar
 * control; Save Rotated Copy writes a new file beside it, as the Rotated Copy quick actions do.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FileEntry } from '../src/domain/contracts';
import type { PreviewCommand, PreviewContext } from '../src/renderer/previews/contracts';
import ImagePreview from '../src/renderer/previews/modules/ImagePreview';
import {
  containedSize,
  nearestTurn,
  normalAngle,
  rotatedCopyRequest,
  savedTurn,
  turnPoint,
  turnedFit,
} from '../src/renderer/previews/rotation';
import {
  conversionTurns,
  rotatableImage,
  turnConversion,
} from '../src/domain/operations/image-conversions';
import { conversionOutput } from '../src/desktop/operations/image-convert';
import { fitRegion } from '../src/domain/files/regions';
import { fileViewValues } from '../src/domain/previews/history';
import { PreviewFrameFixture } from './support/preview-frame';

describe('turning a view', () => {
  it('settles on the nearest quarter, 0 up to 360, and reads a saved turn as one', () => {
    expect(normalAngle(-90)).toBe(270);
    expect(normalAngle(450)).toBe(90);
    expect(nearestTurn(50)).toBe(90);
    expect(nearestTurn(-40)).toBe(0);
    expect(nearestTurn(-50)).toBe(270);
    // a project's view state is read back unchecked
    expect(savedTurn('90')).toBe(90);
    expect(savedTurn(45)).toBe(90);
    expect(savedTurn(44)).toBe(0);
    expect(savedTurn('sideways')).toBe(0);
    expect(savedTurn(undefined)).toBe(0);
  });
  it('fits a turned picture whole, never larger than its own pixels, and upright as laid out', () => {
    // 2400 × 900, laid out 560 × 210 in a 560 × 360 stage
    const shown = { width: 560, height: 210 };
    const natural = { width: 2400, height: 900 };
    const room = { width: 560, height: 360 };
    expect(turnedFit(shown, natural, room, 0)).toBe(1);
    expect(turnedFit(shown, natural, room, 180)).toBe(1);
    // upright, the stylesheet fits it: even where the room is smaller than it is laid out
    expect(turnedFit(shown, natural, { width: 100, height: 100 }, 360)).toBe(1);
    // on its side it is 360 tall: 560 → 360
    expect(turnedFit(shown, natural, room, 90)).toBeCloseTo(360 / 560);
    expect(turnedFit(shown, natural, room, -90)).toBeCloseTo(360 / 560);
    // half way round, its corners' box fits
    expect(turnedFit(shown, natural, room, 45)).toBeCloseTo(360 / ((560 + 210) * Math.SQRT1_2));
    // a small picture turned stays at its own size
    const small = { width: 100, height: 50 };
    expect(turnedFit(small, small, room, 90)).toBe(1);
  });
  it('lays a picture out as the stylesheet does: smaller to fit, never larger', () => {
    const room = { width: 560, height: 360 };
    expect(containedSize({ width: 2400, height: 900 }, room)).toEqual({ width: 560, height: 210 });
    expect(containedSize({ width: 100, height: 50 }, room)).toEqual({ width: 100, height: 50 });
    expect(containedSize({ width: 0, height: 0 }, room)).toEqual({ width: 0, height: 0 });
  });
  it('turns an offset with the picture', () => {
    expect(turnPoint({ x: 10, y: 0 }, 90)).toEqual({ x: 0, y: 10 });
    expect(turnPoint({ x: 10, y: 5 }, 180)).toEqual({ x: -10, y: -5 });
  });
  it('remembers a turn with the zoom and pan it was made with', () => {
    const values = { 'image.turn': 90, 'image.zoom': 2, 'image.pan': { x: 40, y: -10 } };
    expect(fileViewValues(values)).toEqual(values);
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
  it('is the Rotated Copy quick action for the turn, its source pinned to the version shown', () => {
    for (const turn of [90, 180, 270] as const) {
      const request = rotatedCopyRequest(entry('Photo.JPG', 'JPG'), turn);
      expect(request).toMatchObject({
        kind: 'convert',
        conversion: turnConversion(turn),
        sources: ['/fixtures/Photo.JPG'],
      });
      expect(conversionTurns[turnConversion(turn)]).toBe(turn);
      expect(request.expectedSources?.[0]?.path).toBe('/fixtures/Photo.JPG');
    }
    expect(turnConversion(90)).toBe('rotate-right');
    expect(turnConversion(270)).toBe('rotate-left');
    expect(turnConversion(180)).toBe('rotate-180');
  });
  it('is named and typed as one rule says, wherever it is made', () => {
    expect(conversionOutput('/a/Photo.JPG', 'rotate-180')).toBe('/a/Photo rotated.JPG');
    expect(conversionOutput('/a/Shot.webp', 'rotate-right')).toBe('/a/Shot rotated.png');
    // a HEIC photo's copy is a JPEG photo, about its size and with its capture time
    expect(conversionOutput('/a/Shot.heic', 'rotate-left')).toBe('/a/Shot rotated.jpg');
    expect(conversionOutput('/a/Shot.HEIF', 'rotate-left')).toBe('/a/Shot rotated.jpg');
    expect(conversionOutput('/a/Loop.gif', 'rotate-left')).toBe('/a/Loop rotated.png');
    // a name that is all extension keeps its whole name
    expect(conversionOutput('/a/.png', 'rotate-right')).toBe('/a/.png rotated.png');
  });
  it('is offered for any picture the system reads, an animated or multipage one refused as made', () => {
    const offered = (name: string, extension: string) => rotatableImage(entry(name, extension));
    expect(offered('a.jpg', 'jpg')).toBe(true);
    expect(offered('a.HEIC', 'HEIC')).toBe(true);
    expect(offered('a.webp', 'webp')).toBe(true);
    expect(offered('a.gif', 'gif')).toBe(true);
    expect(offered('a.tiff', 'tiff')).toBe(true);
    expect(offered('a.svg', 'svg')).toBe(false);
  });
});

/** A view's remembered values, as the preview store keeps them for a file. */
const store = (seed: Record<string, unknown> = {}) => {
  const values = new Map<string, unknown>(Object.entries(seed));
  return {
    values,
    state: { get: (key: string) => values.get(key), set: values.set.bind(values) },
  };
};
/** The commands a preview registered, as its plane would list them. */
let registered: PreviewCommand[] = [];
const context = (state: PreviewContext['state'], more: Partial<PreviewContext> = {}) =>
  ({
    resource: { id: 'picture', url: 'viewer-resource://picture', entry: entry('a.png', 'png') },
    active: true,
    interactive: true,
    look: 'dark',
    signal: new AbortController().signal,
    state,
    rotatedCopy: vi.fn(),
    commands: {
      register: (commands: readonly PreviewCommand[]) => {
        registered = [...commands];
        return () => {};
      },
    },
    services: { thumbnail: vi.fn() },
    ...more,
  }) as unknown as PreviewContext;
const show = (value: PreviewContext) =>
  render(
    <PreviewFrameFixture>
      <ImagePreview {...value} />
    </PreviewFrameFixture>,
  );
const turnOf = (view: ReturnType<typeof render>) =>
  Number(view.container.querySelector<HTMLElement>('.image-stage')!.dataset.turn);
const picture = (view: ReturnType<typeof render>) => view.container.querySelector('img')!;
const scaleOf = (view: ReturnType<typeof render>) =>
  Number(/scale\(([\d.e-]+)\)/.exec(picture(view).style.transform)?.[1]);
const command = (id: string) => registered.find((item) => item.id === id);
/** The toolbar's items, in order: what a turn must leave as it was. */
const items = (view: ReturnType<typeof render>) =>
  [...view.container.querySelectorAll<HTMLElement>('.preview-toolbar [data-header-item]')].map(
    (item) => item.dataset.headerItem,
  );

/** jsdom lays nothing out: the stage is 600 × 400 and the picture laid out 560 × 210. */
function layOut() {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.matches('.image-stage') ? 600 : this.matches('img') ? 560 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.matches('.image-stage') ? 400 : this.matches('img') ? 210 : 0;
  });
}
/** The picture's own pixels, as the browser reports them once it has loaded. */
function load(view: ReturnType<typeof render>, width = 2400, height = 900) {
  const image = picture(view);
  Object.defineProperty(image, 'naturalWidth', { value: width, configurable: true });
  Object.defineProperty(image, 'naturalHeight', { value: height, configurable: true });
  fireEvent.load(image);
}

describe('the picture preview', () => {
  beforeEach(() => {
    registered = [];
    Object.assign(window, { viewer: { onEvent: () => () => {} } });
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('turns from its toolbar, remembered, the short way round, easing into place', () => {
    vi.useFakeTimers();
    const { values, state } = store();
    const view = show(context(state));
    const right = screen.getByRole('button', { name: 'Rotate right' });
    // the two stay together as one toolbar item, their keys from the keymap in the tooltip
    expect(right.closest('[data-header-item]')).toBe(
      screen.getByRole('button', { name: 'Rotate left' }).closest('[data-header-item]'),
    );
    expect(right.getAttribute('title')).toBe('Rotate right (⌘R)');
    fireEvent.click(right);
    expect(turnOf(view)).toBe(90);
    expect(picture(view).style.transform).toContain('rotate(90deg)');
    expect(picture(view).style.transition).toBe('transform 150ms ease-out');
    act(() => vi.advanceTimersByTime(200));
    expect(picture(view).style.transition).toBe('');
    expect(values.get('image.turn')).toBe(90);
    // left from 0 is 270, drawn the short way round
    fireEvent.click(screen.getByRole('button', { name: 'Rotate left' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rotate left' }));
    expect(turnOf(view)).toBe(270);
    expect(picture(view).style.transform).toContain('rotate(-90deg)');
    view.unmount();
    // the file's view, shown again, is still turned
    expect(turnOf(show(context(state)))).toBe(270);
  });

  it('reads a saved turn that is not a quarter as one', () => {
    expect(picture(show(context(store({ 'image.turn': '90' }).state))).style.transform).toContain(
      'rotate(90deg)',
    );
    cleanup();
    expect(turnOf(show(context(store({ 'image.turn': 45 }).state)))).toBe(90);
  });

  it('keeps Save Rotated Copy in place, waiting with its reason until there is a turn', () => {
    const rotatedCopy = vi.fn();
    const view = show(context(store().state, { rotatedCopy }));
    const before = items(view);
    const save = screen.getByRole('button', { name: 'Save Rotated Copy' });
    // it waits, but keeps the keyboard, so the keyboard and VoiceOver learn why as a pointer does
    expect(save).toHaveProperty('disabled', false);
    expect(save.getAttribute('aria-disabled')).toBe('true');
    const reason = 'Turn the picture first, then save it turned.';
    expect(document.getElementById(save.getAttribute('aria-describedby')!)?.textContent).toBe(
      reason,
    );
    expect(save.getAttribute('title')).toBe(reason);
    save.focus();
    expect(document.activeElement).toBe(save);
    // pressed while it waits, it does nothing
    fireEvent.click(save);
    expect(rotatedCopy).not.toHaveBeenCalled();
    expect(command('image-rotated-copy')?.available).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Rotate right' }));
    // nothing came or went: every control stays where it was
    expect(items(view)).toEqual(before);
    expect(save.hasAttribute('aria-disabled')).toBe(false);
    expect(save.hasAttribute('aria-describedby')).toBe(false);
    expect(command('image-rotated-copy')?.available).toBe(true);
    fireEvent.click(save);
    expect(rotatedCopy).toHaveBeenCalledWith(90);
  });

  it('offers no Save Rotated Copy where the host makes none, and none in an Essential header', () => {
    show(context(store().state, { rotatedCopy: undefined }));
    expect(screen.queryByRole('button', { name: 'Save Rotated Copy' })).toBeNull();
    expect(command('image-rotated-copy')).toBeUndefined();
    cleanup();
    show(context(store().state, { toolbar: 'essential' }));
    expect(screen.queryByRole('button', { name: 'Save Rotated Copy' })).toBeNull();
    // in "…" as a command once there is a turn
    expect(command('image-rotated-copy')?.available).toBe(false);
  });

  it('hints and answers the person’s own keys', () => {
    show(
      context(store().state, {
        shortcuts: { 'image-rotate-right': 'Cmd+Shift+R', 'image-rotate-left': '' },
      }),
    );
    expect(screen.getByRole('button', { name: 'Rotate right' }).getAttribute('title')).toBe(
      'Rotate right (⇧⌘R)',
    );
    // a cleared key leaves the name alone
    expect(screen.getByRole('button', { name: 'Rotate left' }).getAttribute('title')).toBe(
      'Rotate left',
    );
    // and ⌘K shows each command with its key, or none
    expect(command('image-rotate-right')?.shortcut).toBe('⇧⌘R');
    expect(command('image-rotate-left')?.shortcut).toBeUndefined();
    cleanup();
    show(context(store().state));
    expect(command('image-rotate-left')?.shortcut).toBe('⌘L');
    expect(command('image-rotate-right')?.shortcut).toBe('⌘R');
  });

  it('fits the turned picture to its stage, as it turns too', () => {
    layOut();
    const view = show(context(store().state));
    load(view);
    expect(scaleOf(view)).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Rotate right' }));
    // on its side in a 560 × 360 room, 40 px inside the 600 × 400 stage
    expect(scaleOf(view)).toBeCloseTo(360 / 560);
  });

  it('fits a remembered turn from its first loaded frame, unseen until then', () => {
    // the stage is 600 × 400; the picture, as measured before its next frame, its alt text's box
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.matches('.image-stage') ? 600 : this.matches('img') ? 40 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.matches('.image-stage') ? 400 : this.matches('img') ? 18 : 0;
    });
    const view = show(context(store({ 'image.turn': 90 }).state));
    // on its side and not yet loaded, it cannot be fitted: it waits unseen
    expect(picture(view).style.visibility).toBe('hidden');
    // its own size with the load: fitted in the same frame it shows, never at 9 times or at 1
    load(view);
    expect(picture(view).style.visibility).toBe('');
    expect(scaleOf(view)).toBeCloseTo(360 / 560);
    cleanup();
    // upright, the stylesheet fits it from the start
    expect(picture(show(context(store().state))).style.visibility).toBe('');
  });

  it('says how large it shows against its own pixels, and shows them one to one', () => {
    layOut();
    const view = show(context(store().state));
    load(view);
    const level = view.container.querySelector('.preview-zoom-level')!;
    // 2400 px laid out 560 wide
    expect(level.textContent).toBe(`${Math.round((560 / 2400) * 100)}%`);
    act(() => void command('image-actual-size')!.run());
    expect(level.textContent).toBe('100%');
    expect(scaleOf(view)).toBeCloseTo(2400 / 560);
  });

  it('fits a referenced region of a turned picture, the stage turned with it', () => {
    layOut();
    const { values, state } = store({ 'image.turn': 90 });
    const anchor = { kind: 'image' as const, x: 0.7, y: 0.2, width: 0.1, height: 0.2 };
    const view = show(
      context(state, {
        evidence: { path: '/fixtures/a.png', version: {} as never, anchor, quote: '' },
      }),
    );
    load(view);
    const fit = 360 / 560;
    // the region as an upright stage would frame it, the stage on its side
    const upright = fitRegion(anchor, { width: 560, height: 210 }, { width: 400, height: 600 });
    expect(values.get('image.zoom')).toBeCloseTo(upright.zoom / fit);
    expect(values.get('image.pan')).toEqual(turnPoint(upright.pan, 90));
  });

  it('says why it cannot show a picture, and offers its own app', () => {
    const openInApp = vi.fn();
    show(
      context(store().state, {
        openInApp,
        resource: {
          id: 'big',
          url: '',
          entry: { ...entry('big.png', 'png'), size: 70_000_000 },
        },
      } as Partial<PreviewContext>),
    );
    expect(screen.getByText('Can’t show this image')).toBeTruthy();
    expect(
      screen.getByText('It’s larger than 64 MB, the most a picture preview reads.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open in Default App' }));
    expect(openInApp).toHaveBeenCalledOnce();
  });
});
