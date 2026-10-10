import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';

export interface MenuItem {
  id: string;
  label: string;
  icon: IconName;
  disabled?: boolean;
}
/** Menus live outside transformed planes and own their keyboard focus. */
export function ContextMenu({
  position,
  items,
  onSelect,
  onClose,
}: {
  position: { x: number; y: number };
  items: MenuItem[];
  onSelect(id: string): void;
  onClose(): void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = menu.current;
    if (element) {
      const rect = element.getBoundingClientRect();
      element.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - rect.width - 8))}px`;
      element.style.top = `${Math.max(8, Math.min(rect.top, innerHeight - rect.height - 8))}px`;
    }
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) close.current();
    };
    window.addEventListener('pointerdown', dismiss);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      if (!document.querySelector('dialog[open]')) previous?.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div
      className="context-menu"
      ref={menu}
      style={{ left: position.x, top: position.y }}
      role="menu"
      aria-label="File actions"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
        );
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        let next = current;
        if (event.key === 'ArrowDown') next = (current + 1) % buttons.length;
        else if (event.key === 'ArrowUp') next = (current - 1 + buttons.length) % buttons.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = buttons.length - 1;
        else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          return;
        } else if (event.key === 'Tab') {
          onClose();
          return;
        } else return;
        event.preventDefault();
        event.stopPropagation();
        buttons[next]?.focus();
      }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          role="menuitem"
          disabled={item.disabled}
          onClick={() => onSelect(item.id)}
        >
          <Icon name={item.icon} size={16} />
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
