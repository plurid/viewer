import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCommands, useCommandRevision } from '../commands/context';
import { CommandResults } from '../commands/CommandResults';
import { rankCommands, type CommandRequest, type ResolvedCommand } from '../commands/registry';
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
  const [query, setQuery] = useState('');
  const menu = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const trigger = useRef(anchor);
  close.current = onClose;
  trigger.current = anchor;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = menu.current;
    if (element) {
      const rect = element.getBoundingClientRect();
      element.style.left = `${Math.max(8, Math.min(position.x, innerWidth - rect.width - 8))}px`;
      element.style.top = `${Math.max(8, Math.min(position.y, innerHeight - rect.height - 8))}px`;
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
  const applicableRecent = recent
    .filter((id) => available.some((command) => command.id === id))
    .slice(0, 2);
  return createPortal(
    <div
      className="context-menu"
      ref={menu}
      style={{ left: position.x, top: position.y }}
      role="dialog"
      aria-label={label}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Tab') onClose();
      }}
    >
      <CommandResults
        query={query}
        onQuery={setQuery}
        rows={rankCommands(available, query, recent)}
        onSelect={select}
        onClose={onClose}
        recent={applicableRecent}
      />
    </div>,
    document.body,
  );
}
