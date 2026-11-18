// @vitest-environment jsdom
/**
 * WHO TURNS A PICTURE: Rotate Picture Left and Right (⌘L, ⌘R) reach the picture that has the
 * keyboard, before the window's command for the same chord, and only then; two fingers on the
 * trackpad reach the picture under the pointer or with the keyboard. The keys are the keymap's:
 * Settings lists them and says when a person's own key would be taken by them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DesktopEvent, FileEntry } from '../src/domain/contracts';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import ImagePreview from '../src/renderer/previews/modules/ImagePreview';
import { previewOwnsKey } from '../src/renderer/previews/keys';
import { gestureSettle } from '../src/renderer/previews/rotation';
import { keyCommand } from '../src/renderer/explorer/input';
import { getState, initialize } from '../src/renderer/state/store';
import {
  resolvedShortcut,
  shippedKeyHolder,
  pictureShortcuts,
  previewShortcuts,
  shortcutLabel,
  shortcutOwner,
} from '../src/domain/preferences/shortcuts';
import { settingsSchema } from '../src/desktop/preferences/settings-schema';
import { PreviewFrameFixture } from './support/preview-frame';

const entry = (name: string): FileEntry => ({
  path: `/fixtures/${name}`,
  parent: '/fixtures',
  name,
  extension: 'png',
  mime: 'image/png',
  kind: 'file',
  directory: false,
  size: 2_100_000,
  created: 1,
  modified: 2,
  hidden: false,
  identity: name,
});
const context = (more: Partial<PreviewContext> = {}, name = 'a.png') => {
  const values = new Map<string, unknown>();
  return {
    resource: { id: `picture:${name}`, url: `viewer-resource://${name}`, entry: entry(name) },
    active: true,
    interactive: true,
    look: 'dark',
    signal: new AbortController().signal,
    state: { get: (key: string) => values.get(key), set: values.set.bind(values) },
    services: { thumbnail: vi.fn() },
    ...more,
  } as unknown as PreviewContext;
};
/** A picture rendered where `place` is, as a host would hold it. */
const show = (more: Partial<PreviewContext> = {}, place?: Element, name?: string) =>
  render(
    <PreviewFrameFixture>
      <ImagePreview {...context(more, name)} />
    </PreviewFrameFixture>,
    place ? { container: place.appendChild(document.createElement('div')) } : {},
  );
const turnOf = (view: ReturnType<typeof render>) =>
  Number(view.container.querySelector<HTMLElement>('.image-stage')!.dataset.turn);
const stage = (view: ReturnType<typeof render>) =>
  view.container.querySelector<HTMLElement>('.image-stage')!;
/** ⌘ and a letter at `target`, as the keyboard sends it there. */
function command(key: string, target: Element, more: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    metaKey: true,
    bubbles: true,
    cancelable: true,
    ...more,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}
/** Whether the window's own commands leave this key to a picture. */
const owned = (key: string, target: Element) => {
  const event = new KeyboardEvent('keydown', { key, metaKey: true });
  Object.defineProperty(event, 'target', { value: target });
  return previewOwnsKey(event);
};

let listeners: ((event: DesktopEvent) => void)[] = [];
const gesture = (rotation: number) =>
  act(() => {
    for (const listener of listeners) listener({ type: 'rotate-gesture', rotation });
  });
beforeEach(() => {
  listeners = [];
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
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
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the keys', () => {
  it('turn the picture once clicked, leaving the focus where it was, and only then', () => {
    const list = document.body.appendChild(document.createElement('div'));
    list.tabIndex = 0;
    list.focus();
    const view = show({}, list);
    // nothing pressed yet: ⌘L is the window's Go to Folder…
    expect(owned('l', list)).toBe(false);
    expect(command('r', list).defaultPrevented).toBe(false);
    // a click on the picture moves no focus, so the list's arrows still work after it
    fireEvent.pointerDown(stage(view));
    expect(document.activeElement).toBe(list);
    expect(owned('r', list)).toBe(true);
    expect(command('r', list).defaultPrevented).toBe(true);
    expect(turnOf(view)).toBe(90);
    command('l', list);
    command('l', list);
    expect(turnOf(view)).toBe(270);
    // a held key turns once
    expect(command('r', list, { repeat: true }).defaultPrevented).toBe(true);
    expect(turnOf(view)).toBe(270);
    // the focus moved to something else: the keys are its own again
    const other = document.body.appendChild(document.createElement('button'));
    other.focus();
    expect(owned('r', other)).toBe(false);
    expect(command('r', other).defaultPrevented).toBe(false);
    expect(turnOf(view)).toBe(270);
  });

  it('stay with the next file’s picture after the clicked one is replaced', () => {
    const list = document.body.appendChild(document.createElement('div'));
    list.tabIndex = 0;
    list.focus();
    const preview = list.appendChild(document.createElement('div'));
    preview.className = 'column-preview';
    const first = show({}, preview);
    fireEvent.pointerDown(stage(first));
    first.unmount();
    preview.replaceChildren();
    const next = show({}, preview, 'b.png');
    expect(command('r', list).defaultPrevented).toBe(true);
    expect(turnOf(next)).toBe(90);
  });

  it('reach the picture from its plane’s header, where its toolbar stands', () => {
    const plane = document.body.appendChild(document.createElement('div'));
    plane.setAttribute('data-plurid-plane', '');
    const slot = plane.appendChild(document.createElement('header'));
    const view = show(
      { commands: { header: slot, register: () => () => {} } },
      plane.appendChild(document.createElement('div')),
    );
    const right = screen.getByRole('button', { name: 'Rotate right' });
    expect(slot.contains(right)).toBe(true);
    right.focus();
    expect(command('r', right).defaultPrevented).toBe(true);
    expect(turnOf(view)).toBe(90);
    // another plane's focus is not this one's
    const other = document.body.appendChild(document.createElement('input'));
    expect(owned('r', other)).toBe(false);
  });

  it('keep to a pinned plane’s own content, not the space its header was left in', () => {
    // pinned, the plane's content floats in the pinned layer; its shell, with the header it
    // gives no slot while pinned, stays in the space
    const space = document.body.appendChild(document.createElement('div'));
    const shell = space.appendChild(document.createElement('div'));
    shell.setAttribute('data-plurid-plane', 'picture');
    const slot = shell.appendChild(document.createElement('div'));
    const folder = space.appendChild(document.createElement('div'));
    folder.setAttribute('data-plurid-plane', 'folder');
    const list = folder.appendChild(document.createElement('div'));
    list.tabIndex = 0;
    const content = space.appendChild(document.createElement('div'));
    content.setAttribute('data-plurid-plane', 'picture');
    const view = show({ commands: { header: slot, register: () => () => {} } }, content);
    list.focus();
    expect(owned('l', list)).toBe(false);
    expect(command('l', list).defaultPrevented).toBe(false);
    // the picture's own place still takes them
    fireEvent.pointerDown(stage(view));
    expect(command('r', content).defaultPrevented).toBe(true);
    expect(turnOf(view)).toBe(90);
  });

  it('are nobody’s while the picture loads out of sight, or cannot be shown', () => {
    const dialog = document.body.appendChild(document.createElement('dialog'));
    dialog.setAttribute('open', '');
    const shown = dialog.appendChild(document.createElement('button'));
    const waiting = dialog.appendChild(document.createElement('div'));
    waiting.className = 'held-preview-layer held-preview-waiting';
    show({}, waiting);
    shown.focus();
    expect(owned('l', shown)).toBe(false);
    expect(command('l', shown).defaultPrevented).toBe(false);
    cleanup();
    document.body.replaceChildren();
    // a picture that cannot be decoded turns nothing
    const view = show({}, document.body);
    fireEvent.error(view.container.querySelector('img')!);
    fireEvent.pointerDown(view.container.querySelector('.empty-state, [role="status"], div')!);
    expect(owned('r', document.body)).toBe(false);
  });

  it('are not a picture’s for a press around its place, only one in it or on the picture it replaced', () => {
    // the space around planes, pressed: no picture's place
    const space = document.body.appendChild(document.createElement('div'));
    const holder = space.appendChild(document.createElement('div'));
    holder.className = 'column-preview';
    const view = show({}, holder);
    fireEvent.pointerDown(space);
    expect(owned('r', document.body)).toBe(false);
    // the page itself is pressed through: no picture's either
    fireEvent.pointerDown(document.body);
    expect(owned('r', document.body)).toBe(false);
    fireEvent.pointerDown(stage(view));
    expect(owned('r', document.body)).toBe(true);
  });

  it('are a dialog’s or a column’s, all of it, as Quick Preview’s footer and the Columns divider', () => {
    const dialog = document.body.appendChild(document.createElement('dialog'));
    dialog.setAttribute('open', '');
    show({}, dialog);
    const footer = dialog.appendChild(document.createElement('button'));
    footer.focus();
    expect(owned('r', footer)).toBe(true);
    cleanup();
    document.body.replaceChildren();
    const column = document.body.appendChild(document.createElement('div'));
    column.className = 'column-preview';
    show({}, column);
    const divider = column.appendChild(document.createElement('button'));
    divider.focus();
    expect(owned('r', divider)).toBe(true);
  });

  it('are not a picture’s for a press in a dialog since closed, or one past a plane', () => {
    const window = document.body.appendChild(document.createElement('div'));
    // a press on Quick Preview's picture, then Quick Preview closes
    const dialog = window.appendChild(document.createElement('dialog'));
    dialog.setAttribute('open', '');
    const quick = show({}, dialog);
    fireEvent.pointerDown(stage(quick));
    quick.unmount();
    dialog.remove();
    // a Columns preview stands in the same window
    const column = window.appendChild(document.createElement('div'));
    column.className = 'column-preview';
    show({}, column, 'b.png');
    window.tabIndex = -1;
    window.focus();
    expect(owned('r', window)).toBe(false);
    // a menu pressed in a plane with no picture, closed, and the keyboard nowhere
    const plane = window.appendChild(document.createElement('div'));
    plane.setAttribute('data-plurid-plane', 'folder');
    const menu = plane.appendChild(document.createElement('div'));
    fireEvent.pointerDown(menu);
    menu.remove();
    window.blur();
    expect(owned('r', document.body)).toBe(false);
  });

  it('come to a large picture once its smaller copy arrives', async () => {
    let arrive: (url: string) => void = () => {};
    const thumbnail = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          arrive = resolve;
        }),
    );
    const view = show({
      resource: {
        id: 'large',
        url: 'viewer-resource://large',
        entry: entry('large.png'),
        dimensions: { width: 20000, height: 20000 },
      },
      // only the smaller copy is asked for
      services: { thumbnail } as unknown as PreviewContext['services'],
    });
    expect(view.container.querySelector('.image-stage')).toBeNull();
    await act(async () => arrive('data:image/png;base64,'));
    fireEvent.pointerDown(stage(view));
    expect(command('r', document.body).defaultPrevented).toBe(true);
    expect(turnOf(view)).toBe(90);
  });

  it('leave the window its command while no picture has the keyboard', () => {
    initialize({
      home: '/fixtures',
      platform: 'darwin',
      state: null,
      locations: [],
      openPaths: [],
    });
    const settings = getState().settings.settings;
    const elsewhere = document.body.appendChild(document.createElement('div'));
    const key = (target: Element) => {
      const event = new KeyboardEvent('keydown', { key: 'l', metaKey: true });
      Object.defineProperty(event, 'target', { value: target });
      return keyCommand(event, settings);
    };
    expect(key(elsewhere)).toBe('go-to');
    const view = show({}, document.body);
    fireEvent.pointerDown(stage(view));
    expect(key(document.body)).toBeUndefined();
    // a picture's own key, saved changed, is no window command
    const changed = new KeyboardEvent('keydown', { key: 'j', metaKey: true });
    Object.defineProperty(changed, 'target', { value: elsewhere });
    expect(
      keyCommand(changed, {
        ...settings,
        shortcuts: { ...settings.shortcuts, 'image-rotate-left': 'Cmd+J' },
      }),
    ).toBeUndefined();
  });
});

describe('the keymap', () => {
  beforeEach(() =>
    initialize({
      home: '/fixtures',
      platform: 'darwin',
      state: null,
      locations: [],
      openPaths: [],
    }),
  );
  it('names the picture keys for Settings', () => {
    expect(previewShortcuts).toEqual({
      'image-rotate-left': 'Cmd+L',
      'image-rotate-right': 'Cmd+R',
    });
    expect(shortcutLabel('image-rotate-left')).toBe('Rotate Picture Left');
    expect(shortcutLabel('image-rotate-right')).toBe('Rotate Picture Right');
  });
  it('says when a person’s own key would be taken by a picture, not for the chords shipped', () => {
    const settings = getState().settings.settings;
    // ⌘L is both Go to Folder… and Rotate Picture Left as shipped: each answers in its place
    expect(shortcutOwner(settings, 'Cmd+L', 'go-to')).toBeUndefined();
    expect(shortcutOwner(settings, 'Cmd+L', 'image-rotate-left')).toBeUndefined();
    // a key the person gives another command is taken by a picture's
    expect(shortcutOwner(settings, 'Cmd+R', 'palette')).toBe('Rotate Picture Right');
    expect(shortcutOwner(settings, 'Cmd+K', 'image-rotate-right')).toBe('Commands…');
    // the two picture keys never share one
    expect(shortcutOwner(settings, 'Cmd+R', 'image-rotate-left')).toBe('Rotate Picture Right');
  });
  it('saves a key the person gives a picture, a shipped key there giving way, never two of theirs on one', () => {
    const settings = getState().settings.settings;
    const parsed = (shortcuts: Record<string, string>) =>
      settingsSchema.safeParse({ ...settings, shortcuts });
    expect(parsed({ 'image-rotate-left': 'Cmd+L' }).success).toBe(true);
    expect(parsed({ 'image-rotate-left': 'Cmd+Shift+K' }).success).toBe(true);
    expect(parsed({ 'image-rotate-left': 'R' }).success).toBe(false);
    // given Rotate Picture Right's ⌘R, Rotate Picture Left keeps it; the right key has none
    const left = { ...settings, shortcuts: { 'image-rotate-left': 'Cmd+R' } };
    expect(settingsSchema.safeParse(left).success).toBe(true);
    expect(pictureShortcuts(left)).toEqual({
      'image-rotate-left': 'Cmd+R',
      'image-rotate-right': '',
    });
    // ⌘K given to Rotate Picture Right: Commands… leaves it, and says so in its row
    const palette = { ...settings, shortcuts: { 'image-rotate-right': 'Cmd+K' } };
    expect(settingsSchema.safeParse(palette).success).toBe(true);
    expect(resolvedShortcut(palette, 'palette')).toBe('');
    expect(shippedKeyHolder(palette, 'palette')).toBe('Rotate Picture Right');
    // two of the person's own on one key are refused
    expect(parsed({ 'image-rotate-right': 'Cmd+J', 'image-rotate-left': 'Cmd+J' }).success).toBe(
      false,
    );
    expect(parsed({ 'image-rotate-right': 'Cmd+J', palette: 'Cmd+J' }).success).toBe(false);
  });
  it('leaves a chord the person gave to a recipe, and refuses to give one to both', () => {
    const settings = getState().settings.settings;
    // a recipe saved on ⌘R before ⌘R turned pictures
    const recipe = {
      id: '6f1d1d5e-3c1f-4a43-9d2f-1d6a7d2f0a11',
      name: 'Rename photos',
      kind: 'batch-rename',
      formats: [],
      recursive: false,
      instructions: '',
      template: '{name}',
      data: 'names',
      shortcut: 'Cmd+R',
    } as unknown as (typeof settings.recipes)[number];
    const saved = { ...settings, recipes: [recipe] };
    expect(pictureShortcuts(saved)).toEqual({
      'image-rotate-left': 'Cmd+L',
      'image-rotate-right': '',
    });
    expect(shippedKeyHolder(saved, 'image-rotate-right')).toBe('Rename photos');
    // the file still loads, and ⌘R runs the recipe
    expect(settingsSchema.safeParse(saved).success).toBe(true);
    expect(shortcutOwner(saved, 'Cmd+R', 'image-rotate-right')).toBe('Rename photos');
    // given to the picture key as well, the desktop refuses to save it
    expect(
      settingsSchema.safeParse({ ...saved, shortcuts: { 'image-rotate-right': 'Cmd+R' } }).success,
    ).toBe(false);
  });
});

describe('two fingers on the trackpad', () => {
  beforeEach(() => vi.useFakeTimers());
  /** The fingers lift: macOS reports 0, and the reports are quiet a moment. */
  const lift = () => {
    gesture(0);
    act(() => vi.advanceTimersByTime(gestureSettle));
  };

  it('turn the picture under the pointer, settling once the reports have been quiet a moment', () => {
    const view = show();
    fireEvent.pointerEnter(stage(view));
    gesture(-30);
    gesture(-40);
    expect(view.container.querySelector('img')!.style.transform).toContain('rotate(70deg)');
    expect(turnOf(view)).toBe(0);
    // a 0 while the fingers rest is no lift: the twist goes on from where it was
    gesture(0);
    act(() => vi.advanceTimersByTime(gestureSettle - 1));
    expect(turnOf(view)).toBe(0);
    gesture(-10);
    expect(view.container.querySelector('img')!.style.transform).toContain('rotate(80deg)');
    act(() => vi.advanceTimersByTime(gestureSettle - 1));
    expect(turnOf(view)).toBe(0);
    act(() => vi.advanceTimersByTime(1));
    expect(turnOf(view)).toBe(90);
    // drawn on the quarter it settled on, not where the fingers left it
    expect(view.container.querySelector('img')!.style.transform).toContain('rotate(90deg)');
    // 20 counterclockwise falls back
    gesture(20);
    lift();
    expect(turnOf(view)).toBe(90);
  });

  it('stay with the picture they started on', () => {
    const first = show();
    const second = show();
    fireEvent.pointerEnter(stage(first));
    gesture(-60);
    fireEvent.pointerLeave(stage(first));
    fireEvent.pointerEnter(stage(second));
    gesture(-30);
    lift();
    expect(turnOf(first)).toBe(90);
    expect(turnOf(second)).toBe(0);
  });

  it('turn the picture with the keyboard when none is under the pointer, and none otherwise', () => {
    const view = show();
    // neither under the pointer nor with the keyboard: the only picture is not taken for it
    gesture(-90);
    lift();
    expect(turnOf(view)).toBe(0);
    const control = view.container.querySelector<HTMLElement>('.preview-toolbar button')!;
    control.focus();
    gesture(-90);
    lift();
    expect(turnOf(view)).toBe(90);
  });

  it('turn the picture whose plane has the keyboard, from its header too, as ⌘R would', () => {
    const plane = document.body.appendChild(document.createElement('div'));
    plane.setAttribute('data-plurid-plane', 'picture');
    const slot = plane.appendChild(document.createElement('header'));
    const view = show(
      { commands: { header: slot, register: () => () => {} } },
      plane.appendChild(document.createElement('div')),
    );
    // Rotate right clicked in the header, the pointer then off the picture
    const right = screen.getByRole('button', { name: 'Rotate right' });
    right.focus();
    fireEvent.click(right);
    gesture(-90);
    lift();
    expect(turnOf(view)).toBe(180);
    // the keyboard in another plane: no picture is the twist's
    const other = document.body.appendChild(document.createElement('div'));
    other.setAttribute('data-plurid-plane', 'folder');
    const list = other.appendChild(document.createElement('div'));
    list.tabIndex = 0;
    list.focus();
    gesture(-90);
    lift();
    expect(turnOf(view)).toBe(180);
  });

  it('turn only a picture in the topmost dialog, and not one loading out of sight', () => {
    const quick = document.body.appendChild(document.createElement('dialog'));
    quick.setAttribute('open', '');
    const view = show({}, quick);
    fireEvent.pointerEnter(stage(view));
    const top = document.body.appendChild(document.createElement('dialog'));
    top.setAttribute('open', '');
    gesture(-90);
    lift();
    expect(turnOf(view)).toBe(0);
    top.remove();
    gesture(-90);
    lift();
    expect(turnOf(view)).toBe(90);
    const waiting = quick.appendChild(document.createElement('div'));
    waiting.className = 'held-preview-waiting';
    const hidden = show({}, waiting);
    fireEvent.pointerEnter(stage(hidden));
    gesture(-90);
    lift();
    expect(turnOf(hidden)).toBe(0);
  });

  it('fit the picture to its stage as they turn it', () => {
    // jsdom lays nothing out: the stage is 600 × 400, the picture laid out 560 × 210
    const size = (element: Element, stage: number, image: number) =>
      element.matches('.image-stage') ? stage : element.matches('img') ? image : 0;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return size(this, 600, 560);
    });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return size(this, 400, 210);
    });
    try {
      const view = show();
      const image = view.container.querySelector('img')!;
      Object.defineProperty(image, 'naturalWidth', { value: 2400 });
      Object.defineProperty(image, 'naturalHeight', { value: 900 });
      fireEvent.load(image);
      fireEvent.pointerEnter(stage(view));
      gesture(-45);
      // half way round, the box of its corners fits the 560 × 360 room
      const scale = Number(/scale\(([\d.e-]+)\)/.exec(image.style.transform)?.[1]);
      expect(scale).toBeCloseTo(360 / ((560 + 210) * Math.SQRT1_2));
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('turn a picture with the keyboard whose keys were all cleared', () => {
    const view = show({
      shortcuts: { 'image-rotate-left': '', 'image-rotate-right': '' },
    } as Partial<PreviewContext>);
    view.container.querySelector<HTMLElement>('.preview-toolbar button')!.focus();
    gesture(-90);
    lift();
    expect(turnOf(view)).toBe(90);
  });

  it('turn nothing in a plane that is not active', () => {
    const view = show({ active: false });
    fireEvent.pointerEnter(stage(view));
    gesture(-90);
    lift();
    expect(turnOf(view)).toBe(0);
  });
});
