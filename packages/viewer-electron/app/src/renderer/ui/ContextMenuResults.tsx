import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { MenuEntry, MenuSection } from '../commands/menu';
import type { ResolvedCommand } from '../commands/registry';
import { contextMenuSections } from '../commands/menu';
import { rankCommands } from '../commands/registry';
import type { Suggestion } from '../commands/suggestions';
import type { HeaderLead } from '../workspace/header-overflow';
import { Icon } from './Icon';
import { layerCoordinates } from './Popover';

const entries = (sections: MenuSection[]) => sections.flatMap((section) => section.entries);
const entryLabel = (entry: MenuEntry) =>
  entry.kind === 'command' ? entry.command.label : entry.label;
type MenuSide = 'left' | 'right';
interface MenuPlacement {
  style: CSSProperties;
  side: MenuSide;
}
interface TypeAhead {
  text: string;
  at: number;
}
/** A pause in typing this long, in milliseconds, starts a new prefix, as in native menus. */
const typeAheadPause = 1000;
/** Text as type-ahead compares it: an é typed or stored as e and its accent is the same letter. */
const folded = (text: string) => text.normalize('NFC').toLocaleLowerCase();

/**
 * Where type-ahead moves in a list without search: letters typed together spell a prefix, found
 * from the active row on; one letter typed again moves on to the next row starting with it.
 */
function typeAhead(
  rows: readonly MenuEntry[],
  current: MenuEntry | undefined,
  text: string,
): MenuEntry | undefined {
  const repeated = [...text].every((letter) => letter === text[0]);
  const prefix = repeated ? text.slice(0, 1) : text;
  const start = current ? rows.indexOf(current) : -1;
  const from = repeated ? start + 1 : Math.max(0, start);
  return [...rows.slice(from), ...rows.slice(0, from)].find((entry) =>
    folded(entryLabel(entry)).startsWith(prefix),
  );
}

/**
 * Scrolls a row's list just enough to show the row. `scrollIntoView` may also scroll what holds
 * the menu's button, which closes the menu.
 */
function reveal(row: HTMLElement | undefined): void {
  const list = row?.closest<HTMLElement>('.command-results');
  if (!row || !list) return;
  const shown = list.getBoundingClientRect();
  const box = row.getBoundingClientRect();
  if (box.top < shown.top) list.scrollTop -= shown.top - box.top;
  else if (box.bottom > shown.bottom) list.scrollTop += box.bottom - shown.bottom;
}

/** What holds the keyboard in a menu: its search field, or the list when it has none. */
function keyboardTarget(content: HTMLElement | null): HTMLElement | null {
  return (
    content?.querySelector<HTMLElement>('.command-search-field input') ??
    content?.querySelector<HTMLElement>('.context-menu > .command-results') ??
    null
  );
}

/** Native-style flyouts retain the search input and the invocation's captured target. */
export function ContextMenuResults({
  commands,
  recent,
  focused,
  suggested,
  lead,
  workspaceIDs,
  closedDefinitionIDs,
  onSelect,
  onClose,
  searchLabel = 'actions',
  searchPlaceholder = `Search ${searchLabel}…`,
  searchable = true,
  listLabel = 'Actions',
  empty = 'No matching actions',
  none = 'No actions available',
  currentID,
  blankIcons = false,
}: {
  commands: readonly ResolvedCommand[];
  recent: readonly string[];
  focused: boolean;
  /** Actions that fit the selection, shown after Recent. */
  suggested?: readonly Suggestion[];
  /** What the plane header could not show, before everything else. */
  lead?: HeaderLead;
  workspaceIDs?: readonly string[];
  closedDefinitionIDs?: readonly string[];
  onSelect(command: ResolvedCommand): void;
  onClose(): void;
  /** What the search finds, in its label: “Search actions”, or a choice's name. */
  searchLabel?: string;
  /** What the empty search field shows: “Search actions…”, or a choice list's “Search”. */
  searchPlaceholder?: string;
  /** Short choice lists use type-ahead and Space in place of a search field. */
  searchable?: boolean;
  /** The list's name: “Actions”, or a choice's name. */
  listLabel?: string;
  /** What a search that finds nothing says: “No matching actions”, or “No matching choices”. */
  empty?: string;
  /** What a list with nothing in it says: “No actions available”, or “No choices”. */
  none?: string;
  /**
   * The current choice: checked, shown and active as the menu opens, so Enter or Space keeps it.
   * With it, rows are radio items.
   */
  currentID?: string;
  /** Rows without an icon keep its place blank, so a choice menu checks only the current one. */
  blankIcons?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [opened, setOpened] = useState<string[]>([]);
  const [active, setActive] = useState({ depth: 0, id: '' });
  const [searchShown, setSearchShown] = useState(searchable);
  if (searchShown !== searchable) {
    // The choices changed under the open menu: what was typed to search them no longer shows.
    setSearchShown(searchable);
    setQuery('');
  }
  const input = useRef<HTMLInputElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const typed = useRef<TypeAhead>({ text: '', at: 0 });
  const id = useId();
  const searching = !!query.trim();
  const sections = useMemo(
    () =>
      contextMenuSections(
        commands,
        recent,
        focused,
        suggested,
        lead,
        workspaceIDs,
        closedDefinitionIDs,
      ),
    [commands, recent, focused, suggested, lead, workspaceIDs, closedDefinitionIDs],
  );
  const levels = [sections];
  for (const branchID of opened) {
    const branch = entries(levels.at(-1)!).find((entry) => entry.id === branchID);
    if (branch?.kind !== 'submenu') break;
    levels.push(branch.sections);
  }
  const searchRows = searching ? rankCommands(commands, query, recent) : [];
  const depth = searching ? 0 : Math.min(active.depth, levels.length - 1);
  const rows: MenuEntry[] = searching
    ? searchRows.map((command) => ({ kind: 'command', id: command.id, command }))
    : entries(levels[depth] ?? []);
  const current =
    rows.find((row) => row.id === active.id) ??
    (searching ? undefined : rows.find((row) => row.id === currentID)) ??
    rows[0];
  const cancelHover = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  const enter = (entry: MenuEntry, depth: number, keyboard = false) => {
    cancelHover();
    const next = opened.slice(0, depth);
    if (entry.kind === 'submenu') next.push(entry.id);
    setOpened(next);
    if (keyboard && entry.kind === 'submenu')
      setActive({ depth: depth + 1, id: entries(entry.sections)[0]?.id ?? '' });
    else setActive({ depth, id: entry.id });
  };
  const hover = (entry: MenuEntry, depth: number) => {
    cancelHover();
    setActive({ depth, id: entry.id });
    // Give the pointer time to cross neighboring rows on its way to an open flyout.
    timer.current = setTimeout(() => enter(entry, depth), 180);
  };
  const back = () => {
    cancelHover();
    const parent = Math.max(0, depth - 1);
    setActive({ depth: parent, id: opened[parent] ?? '' });
    setOpened(opened.slice(0, parent));
  };
  useEffect(() => {
    // A delayed docking effect may focus plane content after this overlay mounts.
    // Keep keyboard ownership here until dismissal; native window focus is unchanged.
    const keepMenuFocus = (event: FocusEvent) => {
      const field = keyboardTarget(content.current);
      if (
        field &&
        document.hasFocus() &&
        event.target instanceof Element &&
        event.target.closest(
          '[data-plurid-entity="PluridPlaneContent"], [data-plurid-entity="PluridView"]',
        )
      )
        field.focus({ preventScroll: true });
    };
    document.addEventListener('focusin', keepMenuFocus);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener('focusin', keepMenuFocus);
    };
  }, []);
  // On opening, and when the search field comes or goes with the number of choices, the
  // keyboard goes to what now holds it rather than to the page.
  useEffect(() => {
    keyboardTarget(content.current)?.focus({ preventScroll: true });
  }, [searchable]);
  // A long list opens on its current choice, shown, as a native menu does. This runs after the
  // layer is placed, so the list already has its final height.
  useEffect(() => {
    if (currentID) reveal(buttons.current.get(rowID(0, currentID)));
    // Once, as it opens: later the person moves through the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const select = (entry: MenuEntry, depth: number) => {
    cancelHover();
    if (entry.kind === 'submenu') {
      if (opened[depth] === entry.id) {
        setOpened(opened.slice(0, depth));
        setActive({ depth, id: entry.id });
      } else enter(entry, depth, true);
    } else onSelect(entry.command);
  };
  const rootSections: MenuSection[] = searching ? [{ entries: rows }] : sections;
  const rowID = (depth: number, entryID: string) => `${id}-${depth}-${encodeURIComponent(entryID)}`;
  return (
    <div
      ref={content}
      className="context-menu-content"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (!searching && levels.length > 1) back();
          else onClose();
        } else if (
          !searching &&
          ['ArrowRight', 'ArrowLeft'].includes(event.key) &&
          input.current?.selectionStart === input.current?.selectionEnd
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (event.key === 'ArrowRight' && current?.kind === 'submenu')
            enter(current, depth, true);
          else if (event.key === 'ArrowLeft' && levels.length > 1) back();
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && rows.length) {
          event.preventDefault();
          event.stopPropagation();
          cancelHover();
          const index = current ? rows.indexOf(current) : 0;
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? rows.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
          const target = rows[next];
          if (target) {
            setActive({ depth, id: target.id });
            reveal(buttons.current.get(rowID(depth, target.id)));
          }
          if (!searching) setOpened(opened.slice(0, depth));
        } else if (event.key === 'Enter' && current) {
          event.preventDefault();
          event.stopPropagation();
          select(current, depth);
        } else if (
          !searchable &&
          event.key.length === 1 &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          event.preventDefault();
          event.stopPropagation();
          const now = Date.now();
          const typing = now - typed.current.at < typeAheadPause;
          // Space chooses, as in a native menu, unless it continues a name being typed.
          if (event.key === ' ' && !typing) {
            if (current) select(current, depth);
            return;
          }
          const text = (typing ? typed.current.text : '') + folded(event.key);
          typed.current = { text, at: now };
          const target = typeAhead(rows, current, text);
          if (target) {
            cancelHover();
            setActive({ depth, id: target.id });
            reveal(buttons.current.get(rowID(depth, target.id)));
          }
        }
      }}
    >
      <div className="context-menu command-search">
        {searchable && (
          <div className="command-search-field">
            <Icon name="search" size={16} />
            <input
              ref={input}
              data-autofocus
              aria-label={`Search ${searchLabel}`}
              placeholder={searchPlaceholder}
              role={searching ? 'combobox' : undefined}
              aria-autocomplete={searching ? 'list' : undefined}
              aria-expanded={searching ? true : undefined}
              aria-controls={`${id}-list-${depth}`}
              aria-activedescendant={current ? rowID(depth, current.id) : undefined}
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => {
                cancelHover();
                setQuery(event.target.value);
                setOpened([]);
                setActive({ depth: 0, id: '' });
                const list = input.current
                  ?.closest('.context-menu')
                  ?.querySelector('.command-results');
                if (list) list.scrollTop = 0;
              }}
            />
          </div>
        )}
        <MenuList
          sections={rootSections}
          depth={0}
          id={`${id}-list-0`}
          label={listLabel}
          empty={empty}
          none={none}
          checkedID={currentID}
          focusable={!searchable}
          searching={searching}
          blankIcons={blankIcons}
          activeID={depth === 0 ? current?.id : opened[0]}
          openedID={opened[0]}
          buttons={buttons.current}
          rowID={rowID}
          onHover={hover}
          onSelect={select}
          onEnter={cancelHover}
          onScroll={() => {
            if (opened.length) {
              cancelHover();
              setOpened([]);
              setActive({ depth: 0, id: opened[0] ?? '' });
            }
          }}
        />
      </div>
      {!searching &&
        levels.slice(1).map((sections, index) => {
          const popupDepth = index + 1;
          const branch = entries(levels[index] ?? []).find((entry) => entry.id === opened[index]);
          return (
            <MenuList
              key={opened.slice(0, popupDepth).join('/')}
              sections={sections}
              depth={popupDepth}
              id={`${id}-list-${popupDepth}`}
              label={branch?.kind === 'submenu' ? branch.label : 'Actions'}
              blankIcons={blankIcons}
              anchor={buttons.current.get(rowID(index, opened[index] ?? ''))}
              activeID={depth === popupDepth ? current?.id : opened[popupDepth]}
              openedID={opened[popupDepth]}
              buttons={buttons.current}
              rowID={rowID}
              onHover={hover}
              onSelect={select}
              onEnter={cancelHover}
              onScroll={() => {
                if (opened.length > popupDepth) setOpened(opened.slice(0, popupDepth));
              }}
            />
          );
        })}
    </div>
  );
}

function MenuList({
  sections,
  depth,
  id,
  label,
  empty = 'No matching actions',
  none = 'No actions available',
  checkedID,
  searching = false,
  focusable = false,
  blankIcons = false,
  anchor,
  activeID,
  openedID,
  buttons,
  rowID,
  onHover,
  onSelect,
  onEnter,
  onScroll,
}: {
  sections: MenuSection[];
  depth: number;
  id: string;
  label: string;
  empty?: string;
  none?: string;
  /** With it, a list of choices: its rows are radio items, this one checked. */
  checkedID?: string;
  searching?: boolean;
  focusable?: boolean;
  blankIcons?: boolean;
  anchor?: HTMLElement;
  activeID?: string;
  openedID?: string;
  buttons: Map<string, HTMLButtonElement>;
  rowID(depth: number, id: string): string;
  onHover(entry: MenuEntry, depth: number): void;
  onSelect(entry: MenuEntry, depth: number): void;
  onEnter(): void;
  onScroll(): void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const hasSubmenus = sections.some((section) =>
    section.entries.some((entry) => entry.kind === 'submenu'),
  );
  const [placement, setPlacement] = useState<MenuPlacement>({
    style: { visibility: 'hidden' },
    side: 'right',
  });
  useLayoutEffect(() => {
    if (!anchor || !list.current) return;
    const row = anchor.getBoundingClientRect();
    const parentElement = anchor.closest<HTMLElement>('.context-menu, .context-submenu')!;
    const parent = parentElement.getBoundingClientRect();
    const popup = list.current.getBoundingClientRect();
    const right = parent.right - 2;
    const left = parent.left - popup.width + 2;
    // Continue in the parent's direction so nested flyouts do not cover the root menu.
    const preferLeft = parentElement.dataset.side === 'left';
    // When possible, reserve room for the next level before choosing a direction.
    // Otherwise a right-opening branch can immediately fold back over the root.
    const rightExtent = right + popup.width * (hasSubmenus ? 2 : 1);
    const side: MenuSide =
      (left >= 8 && (preferLeft || rightExtent > innerWidth - 8)) ||
      right + popup.width > innerWidth - 8
        ? 'left'
        : 'right';
    const position = layerCoordinates(list.current, {
      left: Math.max(8, Math.min(side === 'left' ? left : right, innerWidth - popup.width - 8)),
      top: Math.max(8, Math.min(row.top - 6, innerHeight - popup.height - 8)),
    });
    setPlacement({
      side,
      style: {
        ...position,
        visibility: 'visible',
      },
    });
  }, [anchor, hasSubmenus]);
  return (
    <div
      className={`command-results${depth ? ' context-submenu' : ''}`}
      style={depth ? placement.style : undefined}
      data-side={depth ? placement.side : undefined}
      ref={list}
      id={id}
      role={searching ? 'listbox' : 'menu'}
      aria-label={label}
      tabIndex={focusable ? -1 : undefined}
      aria-activedescendant={focusable && activeID ? rowID(depth, activeID) : undefined}
      onPointerEnter={onEnter}
      onScroll={onScroll}
    >
      {!entries(sections).length && (
        <p className="command-empty" role="status">
          {searching ? empty : none}
        </p>
      )}
      {sections.map((section, sectionIndex) => (
        <div key={section.label ?? sectionIndex} role="group" aria-label={section.label}>
          {sectionIndex > 0 && <div className="command-divider" role="separator" />}
          {section.label && (
            <div className="command-group" aria-hidden="true">
              {section.label}
            </div>
          )}
          {section.entries.map((entry) => {
            const command = entry.kind === 'command' ? entry.command : undefined;
            const name = command?.label ?? (entry.kind === 'submenu' ? entry.label : '');
            const elementID = rowID(depth, entry.id);
            const radio = !searching && checkedID !== undefined;
            return (
              <button
                type="button"
                key={entry.id}
                ref={(element) => {
                  if (element) buttons.set(elementID, element);
                  else buttons.delete(elementID);
                }}
                id={elementID}
                data-menu-id={entry.id}
                tabIndex={-1}
                role={searching ? 'option' : radio ? 'menuitemradio' : 'menuitem'}
                aria-selected={searching ? activeID === entry.id : undefined}
                aria-checked={radio ? checkedID === entry.id : undefined}
                aria-haspopup={entry.kind === 'submenu' ? 'menu' : undefined}
                aria-expanded={entry.kind === 'submenu' ? openedID === entry.id : undefined}
                data-active={activeID === entry.id}
                className="command-result"
                onPointerEnter={() => onHover(entry, depth)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(entry, depth)}
              >
                {blankIcons && command && !command.icon ? (
                  <span className="command-icon-spacer" aria-hidden="true" />
                ) : (
                  <Icon
                    name={command?.icon ?? (entry.kind === 'submenu' ? entry.icon : 'file')}
                    size={16}
                  />
                )}
                <span className="command-result-text">
                  <span>{name}</span>
                  {searching ? (
                    <small>{command?.detail ?? command?.group}</small>
                  ) : (
                    entry.kind === 'command' && entry.note && <small>{entry.note}</small>
                  )}
                </span>
                {command?.shortcut && <kbd>{command.shortcut}</kbd>}
                {entry.kind === 'submenu' && <Icon name="right" size={12} />}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
