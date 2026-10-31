import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * A NARROW PLANE HEADER: its items give way, measured, into the plane's "…" menu, where they lead
 * as their commands. The title keeps 96 px; Frame, Dock, "…" and × are never items. A format's
 * control with no command never gives way: the format's toolbar scrolls, its edge showing, only
 * once nothing else can go.
 */

/** How long an item keeps its place: 1 stays longest, 9 gives way first. */
export type HeaderRank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
/** What a header item is: a control, as the commands that stand in for it in "…", or a
 * read-only `detail`, such as an image's size, which simply gives way. */
export type HeaderItemKind = readonly string[] | 'detail';

/** The title's own room before anything gives way. */
export const titleMinimum = 96;
/** A few pixels' doubt keeps what gave way away: a header measured in either state differs by the
 * gaps of the groups it hides, and a header at its edge would otherwise flicker. */
const hysteresis = 8;
/** The header's icon buttons are 28 px wide (planes.css). */
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
    if (hidden(child)) {
      // a group every item of which gave way keeps its gap for when they return
      if (child.querySelector('[data-spilled]')) used += gap;
      continue;
    }
    shown++;
    // a format's toolbar or a group shrunk to fit still needs its content's width
    used += child.classList.contains('plane-heading')
      ? titleMinimum
      : Math.max(child.offsetWidth, child.scrollWidth);
  }
  const style = getComputedStyle(header);
  const room = header.clientWidth - number(style.paddingLeft) - number(style.paddingRight);
  const natural = used + Math.max(0, shown - 1) * gap + away;
  return { excess: natural - room + (away ? hysteresis : 0), candidates };
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
export function useHeaderOverflow(header: RefObject<HTMLElement | null>): HeaderLead {
  const widths = useRef(new Map<string, number>());
  const [lead, setLead] = useState<HeaderLead>([]);
  useLayoutEffect(() => {
    const element = header.current;
    if (!element) return;
    let frame = 0;
    const slot = () => element.querySelector<HTMLElement>('.plane-module-controls');
    const update = () => {
      frame = 0;
      const items = [...element.querySelectorAll<HTMLElement>('[data-header-item]')];
      markPinnedTwins(items);
      const { excess, candidates } = measure(element, items, widths.current);
      // a hidden "…" comes back for what gives way: its room counts until it is there
      const menu = element.querySelector('[data-header-menu]') ? 0 : iconWidth + gapOf(element);
      const spilled = new Set(spillHeader(excess, candidates, menu));
      const next: string[][] = [];
      for (const item of items) {
        const away = spilled.has(idOf(item));
        item.toggleAttribute('data-spilled', away);
        if (away && commandsOf(item).length) next.push(commandsOf(item));
      }
      markScrolling(slot());
      setLead((previous) => (sameLead(previous, next) ? previous : next));
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(update);
    };
    update();
    const resized = new ResizeObserver(schedule);
    resized.observe(element);
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
      resized.disconnect();
      changed.disconnect();
      element.removeEventListener('scroll', scrolled, true);
    };
  }, [header]);
  return lead;
}
