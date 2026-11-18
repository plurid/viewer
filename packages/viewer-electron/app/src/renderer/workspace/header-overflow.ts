import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/**
 * A NARROW PLANE HEADER: its items give way, measured, into the plane's "…" menu, where they lead
 * as their commands. The title keeps 96 px; Frame, Dock, "…" and × are never items. A labelled
 * action (`data-header-collapse`) first shows as its named icon. A format's control with no
 * command never gives way: the format's toolbar scrolls, its edge showing, only once nothing else
 * can go. A preview's toolbar outside a plane header is measured the same way, by itself.
 */

/** How long an item keeps its place: 1 stays longest, 9 gives way first. */
export type HeaderRank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
/** What a header item is: a control, as the commands that stand in for it in "…", or a
 * read-only `detail`, such as an image's size, which simply gives way. */
export type HeaderItemKind = readonly string[] | 'detail';

/** The title's own room before anything gives way. */
export const titleMinimum = 96;
/** A few pixels' doubt keeps what gave way away: a header measured in either state differs by the
 * gaps of the groups it hides, and a header at its edge would otherwise flicker. Only coming back
 * needs them to spare: what does not fit goes at once, and no more than that. */
const hysteresis = 8;
/** A plane header's icon buttons are 28 px wide (planes.css), a preview toolbar's 30. */
const iconWidth = 28;
const pinPrefix = 'pin:';

/** The attributes that make an element a header item. */
export function headerItem(
  id: string,
  rank: HeaderRank,
  kind: HeaderItemKind,
): Record<string, string> {
  return {
    'data-header-item': id,
    'data-header-rank': String(rank),
    ...(kind === 'detail'
      ? { 'data-header-detail': '' }
      : { 'data-header-commands': kind.join(' ') }),
  };
}
/** A pinned tool's item: a format's own control for the same command then shows once, as the pin. */
export const pinnedItem = (command: string) => headerItem(pinPrefix + command, 6, [command]);
/** The "…" button's attribute: the header shows it for spilled items even when the person hid it. */
export const headerMenu = { 'data-header-menu': '' };
/** A "…" shown only because something gave way: what it takes counts only while something does,
 * so everything can come back once it all fits without it. */
export const spillMenu = { 'data-header-menu': 'spill' };

export interface SpillCandidate {
  id: string;
  rank: HeaderRank;
  /** Its width and the gap beside it. */
  cost: number;
}
/**
 * Which items give way, the first to go first, so `excess` pixels fit: strictly in rank order, the
 * rightmost first among equals, and none once the header fits. `menu` is what the "…" button
 * costs when the person hid it: it comes back once anything gives way.
 */
export function spillHeader(
  excess: number,
  candidates: readonly SpillCandidate[],
  menu = 0,
): string[] {
  if (excess <= 0) return [];
  const order = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => b.candidate.rank - a.candidate.rank || b.index - a.index);
  const spilled: string[] = [];
  let left = excess + menu;
  for (const { candidate } of order) {
    if (left <= 0) break;
    spilled.push(candidate.id);
    left -= candidate.cost;
  }
  return spilled;
}

/**
 * What gives way, as `spillHeader` says, except that what is `away` already stays away until it
 * would come back with a few pixels to spare. Both are the same first items in rank order.
 */
export function settleHeader(
  excess: number,
  candidates: readonly SpillCandidate[],
  away: ReadonlySet<string>,
  menu = 0,
): string[] {
  const must = spillHeader(excess, candidates, menu);
  const doubtful = spillHeader(excess + hysteresis, candidates, menu);
  let stays = 0;
  while (stays < doubtful.length && away.has(doubtful[stays]!)) stays++;
  return stays > must.length ? doubtful.slice(0, stays) : must;
}

/** The spilled items' commands, in header order, which lead the "…" menu. */
export type HeaderLead = readonly (readonly string[])[];

const number = (value: string) => Number.parseFloat(value) || 0;
const gapOf = (element: Element) => number(getComputedStyle(element).columnGap);
const hidden = (element: Element) => getComputedStyle(element).display === 'none';
const idOf = (element: HTMLElement) => element.dataset.headerItem!;
const commandsOf = (element: HTMLElement) =>
  element.dataset.headerCommands?.split(' ').filter(Boolean) ?? [];

/** Hides a format's control that runs only what the person pinned to this header. */
function markPinnedTwins(items: readonly HTMLElement[]): void {
  const pinned = new Set(
    items.filter((item) => idOf(item).startsWith(pinPrefix)).flatMap(commandsOf),
  );
  for (const item of items) {
    const commands = commandsOf(item);
    item.toggleAttribute(
      'data-pinned-twin',
      !idOf(item).startsWith(pinPrefix) &&
        commands.length > 0 &&
        commands.every((id) => pinned.has(id)),
    );
  }
}

/**
 * What a header child needs. A flexible one, such as a toolbar's spacer or a search field that
 * grows, takes whatever is left, so its present width says nothing: it needs only its minimum.
 */
function needed(child: HTMLElement): number {
  const style = getComputedStyle(child);
  if (number(style.flexGrow) > 0) return number(style.minWidth);
  // a format's toolbar or a group shrunk to fit still needs its content's width
  return Math.max(child.offsetWidth, child.scrollWidth);
}

/** What the header needs with every item shown, the title at its minimum, beyond what it has. */
function measure(
  header: HTMLElement,
  items: readonly HTMLElement[],
  widths: Map<string, number>,
): { excess: number; candidates: SpillCandidate[] } {
  const candidates: SpillCandidate[] = [];
  let away = 0;
  for (const item of items) {
    if (item.hasAttribute('data-pinned-twin')) continue;
    const spilled = item.hasAttribute('data-spilled');
    // an item away has no width: it keeps the one it had
    if (!spilled && !hidden(item)) widths.set(idOf(item), item.offsetWidth);
    const cost = (widths.get(idOf(item)) ?? 0) + gapOf(item.parentElement!);
    if (spilled) away += cost;
    if (item.hasAttribute('data-header-detail') || commandsOf(item).length)
      candidates.push({
        id: idOf(item),
        rank: Number(item.dataset.headerRank) as HeaderRank,
        cost,
      });
  }
  const gap = gapOf(header);
  let shown = 0;
  let used = 0;
  for (const child of header.children as HTMLCollectionOf<HTMLElement>) {
    // its room is reserved when anything gives way (`spillHeader`'s `menu`)
    if (child.dataset.headerMenu === 'spill') continue;
    if (hidden(child)) {
      // a group every item of which gave way keeps its gap for when they return
      if (child.querySelector('[data-spilled]')) used += gap;
      continue;
    }
    shown++;
    used += child.classList.contains('plane-heading') ? titleMinimum : needed(child);
  }
  const style = getComputedStyle(header);
  const room = header.clientWidth - number(style.paddingLeft) - number(style.paddingRight);
  const natural = used + Math.max(0, shown - 1) * gap + away;
  return { excess: natural - room, candidates };
}

/** What a "…" the header has not shown yet will take: as wide as its icon buttons. */
function menuWidth(header: HTMLElement): number {
  const icons = [...header.querySelectorAll<HTMLElement>('.icon-button')];
  return icons.map((icon) => icon.offsetWidth).find((width) => width > 0) ?? iconWidth;
}

/** Shows which side of the format's toolbar scrolls on: its last resort, never invisible. */
function markScrolling(slot: HTMLElement | null): void {
  if (!slot) return;
  const end = slot.scrollWidth - slot.clientWidth - slot.scrollLeft > 1;
  const start = slot.scrollLeft > 1;
  const edge = start && end ? 'both' : start ? 'start' : end ? 'end' : '';
  if (edge) slot.dataset.overflow = edge;
  else delete slot.dataset.overflow;
}

const sameLead = (a: HeaderLead, b: HeaderLead) =>
  a.length === b.length && a.every((ids, index) => ids.join(' ') === b[index]!.join(' '));

/**
 * Measures the header as it lays out, and again when it is resized or a format's toolbar
 * changes: items that do not fit get `data-spilled`, and their commands lead "…".
 */
export function useHeaderOverflow(
  header: RefObject<HTMLElement | null>,
  enabled = true,
): HeaderLead {
  const widths = useRef(new Map<string, number>());
  const [lead, setLead] = useState<HeaderLead>([]);
  useLayoutEffect(() => {
    const element = header.current;
    if (!element || !enabled) return;
    let frame = 0;
    const slot = () => element.querySelector<HTMLElement>('.plane-module-controls');
    const update = () => {
      frame = 0;
      const items = [...element.querySelectorAll<HTMLElement>('[data-header-item]')];
      markPinnedTwins(items);
      const away = new Set(items.filter((item) => item.hasAttribute('data-spilled')).map(idOf));
      // A labelled action shows as its icon before anything gives way, the least important
      // first. Each pass starts from every label shown, so a frame that grows gets them back.
      const collapsible = items
        .filter((item) => item.hasAttribute('data-header-collapse'))
        .sort((a, b) => Number(b.dataset.headerRank) - Number(a.dataset.headerRank));
      for (const item of collapsible) item.removeAttribute('data-spilled');
      // a "…" the person hid comes back for what gives way: its room counts only then
      const menu = element.querySelector('[data-header-menu=""]')
        ? 0
        : menuWidth(element) + gapOf(element);
      // What gives way even with every label an icon goes anyway: no label becomes an icon for
      // its sake, so the controls that stay keep the labels they had without it.
      for (const item of collapsible) item.setAttribute('data-compact', '');
      const tight = measure(element, items, widths.current);
      const anyway = new Set(settleHeader(tight.excess, tight.candidates, away, menu));
      for (const item of collapsible) item.removeAttribute('data-compact');
      const over = () => {
        const { excess, candidates } = measure(element, items, widths.current);
        const going = candidates
          .filter((candidate) => anyway.has(candidate.id))
          .reduce((total, candidate) => total + candidate.cost, 0);
        return excess - going + (anyway.size ? menu : 0);
      };
      for (const item of collapsible) {
        if (over() <= 0) break;
        item.setAttribute('data-compact', '');
      }
      const { excess, candidates } = measure(element, items, widths.current);
      const spilled = new Set(settleHeader(excess, candidates, away, menu));
      const next: string[][] = [];
      const focus = document.activeElement;
      let hid = false;
      for (const item of items) {
        const gone = spilled.has(idOf(item));
        if (gone && !item.hasAttribute('data-spilled') && focus && item.contains(focus)) hid = true;
        item.toggleAttribute('data-spilled', gone);
        if (gone && commandsOf(item).length) next.push(commandsOf(item));
      }
      markScrolling(slot());
      setLead((previous) => (sameLead(previous, next) ? previous : next));
      // A control the keyboard was on gave way: the keyboard goes to "…", which holds it now,
      // once "…" is there to take it.
      if (hid)
        requestAnimationFrame(() =>
          element.querySelector<HTMLElement>('[data-header-menu]')?.focus({ preventScroll: true }),
        );
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(update);
    };
    update();
    // test documents may lack ResizeObserver; Chromium always has it
    const resized =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    resized?.observe(element);
    // a format portals its toolbar into the slot and changes it as it works; the attributes set
    // here are not watched
    const changed = new MutationObserver(schedule);
    changed.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-header-item', 'data-header-rank', 'data-header-commands', 'class'],
    });
    const scrolled = () => markScrolling(slot());
    element.addEventListener('scroll', scrolled, true);
    return () => {
      cancelAnimationFrame(frame);
      resized?.disconnect();
      changed.disconnect();
      element.removeEventListener('scroll', scrolled, true);
    };
  }, [header, enabled]);
  return lead;
}
