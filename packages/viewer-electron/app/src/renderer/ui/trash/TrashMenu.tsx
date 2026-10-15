import { useEffect, useRef, type CSSProperties } from 'react';
import type { ResolvedCommand } from '../../commands/registry';
import { ContextMenuResults } from '../ContextMenuResults';
import type { MenuAction } from './items';

/** This menu stays inside the native dialog's top layer. It is deliberately not
 * registered in the command catalog: agents cannot publish or invoke its UI. */
export function TrashMenu({
  position,
  actions,
  onClose,
}: {
  position: { x: number; y: number };
  actions: MenuAction[];
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
      element.style.top = `${Math.max(8, Math.min(position.y, innerHeight - rect.height - 8))}px`;
    }
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close.current();
    };
    window.addEventListener('pointerdown', dismiss);
    return () => window.removeEventListener('pointerdown', dismiss);
  }, [position]);
  const commands: ResolvedCommand[] = actions.map((action) => ({
    ...action,
    source: 'trash-ui',
    group: 'Files',
    aliases: [],
    primary: true,
    context: { scope: 'files', workspaceID: '', selection: [], jobs: [], clipboard: null },
  }));
  return (
    <div
      ref={root}
      className="trash-context-menu"
      style={{ '--menu-left': `${position.x}px`, '--menu-top': `${position.y}px` } as CSSProperties}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <ContextMenuResults
        commands={commands}
        recent={[]}
        focused
        onClose={onClose}
        onSelect={(command) => {
          onClose();
          requestAnimationFrame(() => actions.find((action) => action.id === command.id)?.run());
        }}
      />
    </div>
  );
}
