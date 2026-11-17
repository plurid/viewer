import { useEffect, useRef } from 'react';
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
 * commands step aside only for a key a preview then takes.
 */

/** Which actions a preview answers, and where. */
interface Claim {
  /** Where the keyboard makes the keys this preview's. */
  scope: HTMLElement;
  /** The preview itself: a next file's preview, loading out of sight, answers nothing. */
  node: HTMLElement;
  current: { readonly shortcuts: Readonly<Record<string, () => void>> };
}
type KeyEvent = Pick<KeyboardEvent, 'target' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'key'> &
  Partial<Pick<KeyboardEvent, 'code' | 'repeat'>>;

const claims = new Set<Claim>();
/** What the pointer last pressed, and the places around it, nearest first. */
let pressed: Element[] = [];
/** Where a press is remembered up to: past these, it is another plane or dialog. */
const boundary = 'dialog, [data-plurid-plane], .plurid-plane, .column-preview, .gallery-preview';

const answers = (claim: Claim) =>
  claim.node.isConnected && !claim.node.closest('.held-preview-waiting');
/** The claims that answer in this place. */
const answering = (scope: Element | null | undefined) =>
  scope ? [...claims].filter((claim) => claim.scope === scope && answers(claim)) : [];

/** The place, among those that answer, whose preview has the keyboard for this event. */
function owner(event: KeyEvent): Element | undefined {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const scopes = new Set([...claims].filter(answers).map((claim) => claim.scope));
  const focused = [...scopes].find((scope) => scope.contains(target));
  if (focused) return focused;
  for (const place of pressed) {
    // a plane or dialog closed since the press: the place is gone
    if (!place.isConnected) {
      if (place.matches(boundary)) return;
      continue;
    }
    // the focus went elsewhere since the press
    if (!target.contains(place)) return;
    const around = [...scopes].filter((scope) => scope.contains(place) || place.contains(scope));
    if (around.length === 1) return around[0];
    if (around.length > 1 || place.matches(boundary)) return;
  }
}
/** The action a preview that has the keyboard takes for this key, if one does. */
function action(event: KeyEvent): (() => void) | undefined {
  for (const claim of answering(owner(event))) {
    const chord = Object.keys(claim.current.shortcuts).find((key) =>
      matchesShortcut(key, event),
    );
    if (chord) return claim.current.shortcuts[chord];
  }
}
/** Whether a preview that has the keyboard takes this key itself: the window's commands then
 * leave it. */
export function previewOwnsKey(event: KeyEvent): boolean {
  return !!action(event);
}

const press = (event: PointerEvent) => {
  pressed = [];
  for (
    let element = event.target instanceof Element ? event.target : null;
    element;
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

/** The smallest element holding both `a` and `b`, short of the whole page. */
function common(a: Element, b: Element): HTMLElement | undefined {
  for (let element: Element | null = a; element; element = element.parentElement)
    if (element.contains(b))
      return element === document.body || element === document.documentElement
        ? undefined
        : (element as HTMLElement);
}
/** Where the keyboard makes a preview's keys its own: see the module comment. */
function scopeOf(node: HTMLElement, header?: HTMLElement): HTMLElement {
  return (
    node.closest<HTMLElement>('dialog') ??
    (header && common(header, node)) ??
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
  current.current = shortcuts;
  const chords = Object.keys(shortcuts).filter(Boolean).join(' ');
  useEffect(() => {
    const node = element.current;
    if (!node || !enabled || !chords) return;
    const claim: Claim = { scope: scopeOf(node, header), node, current };
    if (!claims.size) {
      window.addEventListener('pointerdown', press, true);
      window.addEventListener('keydown', keydown, true);
    }
    claims.add(claim);
    return () => {
      claims.delete(claim);
      if (claims.size) return;
      window.removeEventListener('pointerdown', press, true);
      window.removeEventListener('keydown', keydown, true);
      pressed = [];
    };
  }, [element, enabled, chords, header]);
}
