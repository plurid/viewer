import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { matchesShortcut } from '../../domain/preferences/shortcuts';

/**
 * A PREVIEW'S OWN SHORTCUTS, as ⌘L and ⌘R turn a picture in Preview.app: they are the preview's
 * while it has the keyboard, before the window's commands for the same chords, such as ⌘L's Go
 * to Folder…, which answer everywhere else.
 *
 * A preview has the keyboard when the focus is in its place: its plane, header and all, the
 * dialog it fills, as Quick Preview, or the Columns or Gallery preview that holds it. It has it
 * too when the person last pressed in that place and the focus stayed around it: a click on a
 * picture moves no focus, so a Columns list's arrows still move the selection after it, and the
 * next file's picture, which replaces the clicked one, keeps the keys.
 *
 * One window listener answers, and `previewOwnsKey` says exactly when it will, so the window's
 * commands step aside only for a key a preview then takes. A trackpad turn goes where the keys
 * would (`previewHasKeyboard`).
 */

/** Which actions a preview answers, and where. */
interface Claim {
  /** Where the keyboard makes the keys this preview's. */
  scope: HTMLElement;
  /** The preview itself: a next file's preview, loading out of sight, answers nothing. */
  node: HTMLElement;
  /** Its chords and what each does, as it last rendered. */
  actions: { readonly current: Readonly<Record<string, () => void>> };
}
/** The parts of a key press a preview reads: a plane's routed keys, as Quick Preview's, are no events. */
type KeyEvent = Pick<KeyboardEvent, KeyEventPart> & Partial<Pick<KeyboardEvent, 'code' | 'repeat'>>;
type KeyEventPart = 'target' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'key';

const claims = new Set<Claim>();
let watching = false;
/** What the pointer last pressed, and the places around it, nearest first. */
let pressed: Element[] = [];
/** A plane, as the space draws it, or the pinned layer its content floats in. */
const planes = '[data-plurid-plane], .plurid-plane';
/** Where a press is remembered up to: past these, it is another plane or dialog. */
const boundary = `dialog, ${planes}, .column-preview, .gallery-preview`;

const answers = (claim: Claim) =>
  claim.node.isConnected && !claim.node.closest('.held-preview-waiting');
/** The claims that answer in this place. */
const answering = (scope: Element | null | undefined) =>
  scope ? [...claims].filter((claim) => claim.scope === scope && answers(claim)) : [];

/** The place, among those that answer, whose preview has the keyboard where `at` is. */
function owner(at: EventTarget | null): Element | undefined {
  const target = at instanceof Element ? at : null;
  if (!target) return;
  const scopes = new Set([...claims].filter(answers).map((claim) => claim.scope));
  const focused = [...scopes].find((scope) => scope.contains(target));
  if (focused) return focused;
  // what was pressed is gone, replaced as a picture is by the next file's: the press counts for
  // the place now standing where it stood
  const replaced = !!pressed[0] && !pressed[0].isConnected;
  for (const place of pressed) {
    // a plane or dialog closed since the press: the place is gone
    if (!place.isConnected) {
      if (place.matches(boundary)) return;
      continue;
    }
    // the focus went elsewhere since the press
    if (!target.contains(place)) return;
    const around = [...scopes].filter(
      (scope) => scope.contains(place) || (replaced && place.contains(scope)),
    );
    if (around.length === 1) return around[0];
    if (around.length > 1 || place.matches(boundary)) return;
  }
}
/** The action a preview that has the keyboard takes for this key, if one does. */
function action(event: KeyEvent): (() => void) | undefined {
  for (const claim of answering(owner(event.target))) {
    const chord = Object.keys(claim.actions.current).find((key) => matchesShortcut(key, event));
    if (chord) return claim.actions.current[chord];
  }
}
/** Whether a preview that has the keyboard takes this key itself: the window's commands then
 * leave it. */
export function previewOwnsKey(event: KeyEvent): boolean {
  return !!action(event);
}
/** Whether the preview at `node` has the keyboard now, as its keys would find it. */
export function previewHasKeyboard(node: Element): boolean {
  const place = owner(document.activeElement ?? document.body);
  return answering(place).some((claim) => claim.node === node);
}

/** Remembers a press, up to the page itself: the page holds every place, and is none of them. */
const press = (event: PointerEvent) => {
  pressed = [];
  for (
    let element = event.target instanceof Element ? event.target : null;
    element && element !== document.body && element !== document.documentElement;
    element = element.parentElement
  )
    pressed.push(element);
};
// At the window, while capturing: the window's own listener, there first, steps aside for these.
const keydown = (event: KeyboardEvent) => {
  if (event.defaultPrevented) return;
  const run = action(event);
  if (!run) return;
  event.preventDefault();
  event.stopPropagation();
  // a held key turns once, as Preview's does
  if (!event.repeat) run();
};

/**
 * Where the keyboard makes a preview's keys its own: see the module comment. Its plane, with the
 * header its toolbar stands in, only while both are that one plane's: a pinned plane's content
 * floats in the pinned layer, and the header it left behind in the space is no part of it.
 */
function scopeOf(node: HTMLElement, header?: HTMLElement): HTMLElement {
  const plane = node.closest<HTMLElement>(planes);
  const together = !!header && !!plane && header.closest(planes) === plane;
  return (
    node.closest<HTMLElement>('dialog') ??
    (together ? plane : undefined) ??
    node.closest<HTMLElement>('.column-preview, .gallery-preview') ??
    node.closest<HTMLElement>('.preview-host') ??
    node
  );
}

/**
 * Gives the preview in `element` its `shortcuts`, chords such as `Cmd+L` and what each does, while
 * `enabled`. `header` is the plane header slot its toolbar stands in, if any.
 */
export function usePreviewKeys(
  element: RefObject<HTMLElement | null>,
  shortcuts: Readonly<Record<string, () => void>>,
  enabled: boolean,
  header?: HTMLElement,
): void {
  const current = useRef(shortcuts);
  // the newest actions, once rendered: a ref is never written while rendering
  useLayoutEffect(() => {
    current.current = shortcuts;
  });
  useEffect(() => {
    const node = element.current;
    // with no chord of its own a preview still has the keyboard, for a trackpad turn
    if (!node || !enabled) return;
    const claim: Claim = { scope: scopeOf(node, header), node, actions: current };
    // Presses are watched from the first preview on, and stay watched: between one file's picture
    // and the next there is a moment with none, and a press then must still count.
    if (!watching) window.addEventListener('pointerdown', press, true);
    watching = true;
    if (!claims.size) window.addEventListener('keydown', keydown, true);
    claims.add(claim);
    return () => {
      claims.delete(claim);
      if (!claims.size) window.removeEventListener('keydown', keydown, true);
    };
  }, [element, enabled, header]);
}
