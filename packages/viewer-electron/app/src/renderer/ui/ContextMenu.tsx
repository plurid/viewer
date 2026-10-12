import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useCommands, useCommandRevision } from '../commands/context';
import { ContextMenuResults } from './ContextMenuResults';
import { type CommandRequest, type ResolvedCommand } from '../commands/registry';
import { report, useViewer } from '../state/store';

/** Outside transformed planes, with a fixed target and keyboard-first search. */
export function ContextMenu({
  position,
  request,
  onClose,
  label = 'Actions',
  anchor,
}: {
  position: { x: number; y: number };
  request: CommandRequest;
  onClose(): void;
  label?: string;
  anchor?: HTMLElement;
}) {
  const registry = useCommands();
  useCommandRevision();
  const recent = useViewer((state) => state.saved.ui.recentCommands);
  const menu = useRef<HTMLDivElement>(null);
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  const close = useRef(onClose);
  const trigger = useRef(anchor);
  close.current = onClose;
  trigger.current = anchor;
  useEffect(() => {
    const previous = previousFocus.current;
    const element = menu.current?.querySelector<HTMLElement>('.context-menu');
    if (element) {
      const rect = element.getBoundingClientRect();
      element.style.left = `${Math.max(8, Math.min(position.x, innerWidth - rect.width - 8))}px`;
      const top = Math.max(8, Math.min(position.y, innerHeight - rect.height - 8));
      element.style.top = `${top}px`;
      element.style.maxHeight = `min(540px, calc(100vh - ${top + 8}px))`;
    }
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) close.current();
    };
    window.addEventListener('pointerdown', dismiss);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      if (!document.querySelector('dialog[open]') && previous?.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  const select = (command: ResolvedCommand) => {
    onClose();
    // Commit closure/focus restoration before a handler opens a protected dialog.
    requestAnimationFrame(() => {
      void registry.run(command).catch(report);
    });
  };
  const available = registry.list(request);
  return createPortal(
    <div
      className="context-menu-layer"
      ref={menu}
      style={
        { '--menu-left': `${position.x}px`, '--menu-top': `${position.y}px` } as React.CSSProperties
      }
      role="dialog"
      aria-label={label}
      data-plurid-overlay="context-menu"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Tab') onClose();
      }}
    >
      <ContextMenuResults
        commands={available}
        onSelect={select}
        onClose={onClose}
        recent={recent}
        focused={!!request.ids}
      />
    </div>,
    document.body,
  );
}
