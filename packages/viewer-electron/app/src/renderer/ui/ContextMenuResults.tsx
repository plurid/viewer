import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { contextMenuSections, type MenuEntry, type MenuSection } from '../commands/menu';
import { rankCommands, type ResolvedCommand } from '../commands/registry';
import { Icon } from './Icon';

const entries = (sections: MenuSection[]) => sections.flatMap((section) => section.entries);

/** Native-style flyouts retain the search input and the invocation's captured target. */
export function ContextMenuResults({
  commands,
  recent,
  focused,
  onSelect,
  onClose,
}: {
  commands: readonly ResolvedCommand[];
  recent: readonly string[];
  focused: boolean;
  onSelect(command: ResolvedCommand): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState('');
  const [opened, setOpened] = useState<string[]>([]);
  const [active, setActive] = useState({ depth: 0, id: '' });
  const input = useRef<HTMLInputElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  const searching = !!query.trim();
  const sections = useMemo(
    () => contextMenuSections(commands, recent, focused),
    [commands, recent, focused],
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
  const current = rows.find((row) => row.id === active.id) ?? rows[0];
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
    const field = input.current;
    field?.focus({ preventScroll: true });
    // A delayed docking effect may focus plane content after this overlay mounts.
    // Keep keyboard ownership here until dismissal; native window focus is unchanged.
    const keepSearchFocus = (event: FocusEvent) => {
      if (
        field?.isConnected &&
        document.hasFocus() &&
        event.target instanceof Element &&
        event.target.closest(
          '[data-plurid-entity="PluridPlaneContent"], [data-plurid-entity="PluridView"]',
        )
      )
        field.focus({ preventScroll: true });
    };
    document.addEventListener('focusin', keepSearchFocus);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener('focusin', keepSearchFocus);
    };
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
            buttons.current.get(rowID(depth, target.id))?.scrollIntoView({ block: 'nearest' });
          }
          if (!searching) setOpened(opened.slice(0, depth));
        } else if (event.key === 'Enter' && current) {
          event.preventDefault();
          event.stopPropagation();
          select(current, depth);
        }
      }}
    >
      <div className="context-menu command-search">
        <div className="command-search-field">
          <Icon name="search" size={16} />
          <input
            ref={input}
            data-autofocus
            aria-label="Search actions"
            placeholder="Search actions…"
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
        <MenuList
          sections={rootSections}
          depth={0}
          id={`${id}-list-0`}
          label="Actions"
          searching={searching}
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
  searching = false,
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
  searching?: boolean;
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
  const [placement, setPlacement] = useState<{
    style: CSSProperties;
    side: 'left' | 'right';
  }>({ style: { visibility: 'hidden' }, side: 'right' });
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
    const side =
      (left >= 8 && (preferLeft || rightExtent > innerWidth - 8)) ||
      right + popup.width > innerWidth - 8
        ? 'left'
        : 'right';
    setPlacement({
      side,
      style: {
        left: Math.max(8, Math.min(side === 'left' ? left : right, innerWidth - popup.width - 8)),
        top: Math.max(8, Math.min(row.top - 6, innerHeight - popup.height - 8)),
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
      onPointerEnter={onEnter}
      onScroll={onScroll}
    >
      {!entries(sections).length && (
        <p className="command-empty" role="status">
          {searching ? 'No matching actions' : 'No actions available'}
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
                role={searching ? 'option' : 'menuitem'}
                aria-selected={searching ? activeID === entry.id : undefined}
                aria-haspopup={entry.kind === 'submenu' ? 'menu' : undefined}
                aria-expanded={entry.kind === 'submenu' ? openedID === entry.id : undefined}
                data-active={activeID === entry.id}
                title={name}
                className="command-result"
                onPointerEnter={() => onHover(entry, depth)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(entry, depth)}
              >
                <Icon
                  name={command?.icon ?? (entry.kind === 'submenu' ? entry.icon : 'file')}
                  size={16}
                />
                <span className="command-result-text">
                  <span>{name}</span>
                  {searching && <small>{command?.detail ?? command?.group}</small>}
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
