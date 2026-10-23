import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { ResolvedCommand } from '../commands/registry';
import { ContextMenuResults } from './ContextMenuResults';
import { Icon } from './Icon';
import { dialogOpen } from './modal';

export interface Choice {
  value: string;
  label: string;
  detail?: string;
  /** Other words the search finds it by: an extension, an abbreviation. */
  aliases?: readonly string[];
}

/**
 * CHOICES USE THE SEARCHABLE MENU (2026-10-23): the context menu's keyboard-first search over a
 * list of values, the current one checked, in place of a native dropdown. Not a command: nothing
 * here reaches the command catalog or agents.
 */
export function ChoiceMenu({
  label,
  choices,
  value,
  position,
  anchor,
  onChoose,
  onClose,
}: {
  label: string;
  choices: readonly Choice[];
  value: string;
  position: { x: number; y: number };
  anchor?: HTMLElement | null;
  onChoose(value: string): void;
  onClose(): void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const element = root.current?.querySelector<HTMLElement>('.context-menu');
    if (element) {
      const rect = element.getBoundingClientRect();
      element.style.left = `${Math.max(8, Math.min(position.x, innerWidth - rect.width - 8))}px`;
      const top = Math.max(8, Math.min(position.y, innerHeight - rect.height - 8));
      element.style.top = `${top}px`;
      element.style.maxHeight = `min(540px, calc(100vh - ${top + 8}px))`;
    }
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !anchor?.contains(target)) close.current();
    };
    window.addEventListener('pointerdown', dismiss);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      if (!dialogOpen() && anchor?.isConnected) anchor.focus({ preventScroll: true });
    };
    // Placed once when opened, like the context menu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const commands: ResolvedCommand[] = choices.map((choice) => ({
    id: 'choice:' + choice.value,
    label: choice.label,
    detail: choice.detail,
    group: label,
    icon: choice.value === value ? 'check' : undefined,
    aliases: [choice.value, ...(choice.aliases ?? [])],
    primary: false,
    source: 'choice',
    context: { scope: 'window', workspaceID: '', selection: [], jobs: [], clipboard: null },
  }));
  return createPortal(
    <div
      ref={root}
      className="context-menu-layer"
      style={{ '--menu-left': `${position.x}px`, '--menu-top': `${position.y}px` } as CSSProperties}
      role="dialog"
      aria-label={label}
      data-plurid-overlay="context-menu"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Tab') onClose();
      }}
    >
      <ContextMenuResults
        commands={commands}
        recent={[]}
        focused
        blankIcons
        searchLabel={label}
        onClose={onClose}
        onSelect={(command) => {
          onClose();
          onChoose(command.id.slice('choice:'.length));
        }}
      />
    </div>,
    document.body,
  );
}

/** A button naming the current choice, which opens its searchable menu below it. */
export function ChoiceButton({
  label,
  value,
  choices,
  onChoose,
  className,
}: {
  label: string;
  value: string;
  choices: readonly Choice[];
  onChoose(value: string): void;
  className?: string;
}) {
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const current = choices.find((choice) => choice.value === value);
  return (
    <>
      <button
        ref={button}
        type="button"
        className={'choice-button' + (className ? ' ' + className : '')}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={!!open}
        onClick={(event) => {
          // inside a settings row's label, a click would also reach the row
          event.preventDefault();
          if (open) {
            setOpen(null);
            return;
          }
          const rect = button.current!.getBoundingClientRect();
          setOpen({ x: rect.left, y: rect.bottom + 4 });
        }}
      >
        <span>{current?.label ?? value}</span>
        <Icon name="down" size={10} />
      </button>
      {open && (
        <ChoiceMenu
          label={label}
          choices={choices}
          value={value}
          position={open}
          anchor={button.current}
          onChoose={onChoose}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
